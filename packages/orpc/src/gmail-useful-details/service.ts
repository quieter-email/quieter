import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { chatModelSchema } from "@quieter/ai/chat-models";
import type { ChatModel } from "@quieter/ai/chat-models";
import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import { extractMailUsefulDetail } from "@quieter/ai/extract-gmail-useful-detail";
import type {
  GmailUsefulDetailCandidate,
  GmailUsefulDetailPreferenceProfile,
} from "@quieter/ai/extract-gmail-useful-detail";
import { reportAiUsage } from "@quieter/billing";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  gmailUsefulDetail,
  gmailUsefulDetailEvent,
  gmailUsefulDetailFeedback,
  mailbox,
  mailboxAutomationSettings,
} from "@quieter/database/schema";
import type {
  GmailDeliveryStatus,
  GmailUsefulDetailFeedbackSignal,
  GmailUsefulDetailKind,
  GmailUsefulDetailRelevanceSource,
} from "@quieter/database/schema";
import { MAILBOX_LABELS } from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import type { ChatMiddleware } from "@tanstack/ai";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";

import {
  buildMailMemoryQuery,
  loadAiAgentContext,
  loadAiConfiguration,
  loadUsefulDetailFeedbackPolicies,
  recordAndRefreshAiMemory,
  serializeAiAgentContext,
} from "../ai-memory";
import { decryptSecret, encryptSecret } from "../gmail-mailbox-access";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { refreshUsefulDetailMemoryProfile } from "../mail-automation/memory";
import { hasText } from "../text";

const RETRY_BASE_MS = 1000 * 60 * 5;
const RETRY_MAX_MS = 1000 * 60 * 60 * 24;
const BUDGET_RETRY_MS = 1000 * 60 * 60 * 6;
const DAY_MS = 1000 * 60 * 60 * 24;
const USEFUL_DETAIL_KINDS: GmailUsefulDetailKind[] = [
  "application",
  "appointment",
  "bill",
  "delivery",
  "document_expiry",
  "reservation",
  "return",
  "security_alert",
  "task",
  "travel",
  "verification_code",
];
const MAX_RELEVANCE_HORIZON_MS = {
  application: DAY_MS * 180,
  appointment: DAY_MS * 365,
  bill: DAY_MS * 90,
  delivery: DAY_MS * 60,
  document_expiry: DAY_MS * 730,
  reservation: DAY_MS * 365,
  return: DAY_MS * 90,
  security_alert: DAY_MS * 7,
  task: DAY_MS * 90,
  travel: DAY_MS * 365,
  verification_code: 1000 * 60 * 30,
} as const satisfies Record<GmailUsefulDetailKind, number>;
const EVENT_DETAIL_VISIBLE_LEAD_MS: Partial<
  Record<GmailUsefulDetailKind, number>
> = {
  appointment: DAY_MS,
  bill: DAY_MS * 7,
  document_expiry: DAY_MS * 30,
  reservation: DAY_MS,
  task: DAY_MS,
  travel: DAY_MS,
};

const excludedLabels = new Set<string>([
  MAILBOX_LABELS.drafts,
  MAILBOX_LABELS.sent,
  MAILBOX_LABELS.spam,
  MAILBOX_LABELS.trash,
]);

const automatedEngineeringSenderPattern =
  /(?:^|[.@<\s-])(?<provider>github|gitlab|bitbucket|jira|linear|sentry|coderabbit|datadog|buildkite|circleci)(?:[.@>\s-]|$)/iu;
const SUPPRESSED_AUTOMATION_KINDS = new Set<GmailUsefulDetailKind>([
  "application",
  "security_alert",
  "task",
]);
const publicCallToActionPattern =
  /\b(?:vote (?:now|today|by|before|for)|cast your vote|sign (?:the )?petition|donate (?:now|today|by|before|to)|fundraiser|abstimm(?:en|ung).{0,40}(?:heute|bis|für)|wahl.{0,40}(?:heute|bis|für)|spenden.{0,40}(?:jetzt|heute|bis|für))\b/iu;
const publicOpportunityPattern =
  /\b(?:job posting|vacancy|open position|position opening|call for applications|applications? (?:are )?open|apply now|bewerbungsfrist|stellenausschreibung|stellenangebot|ausschreibung|scholarship|stipendium)\b/iu;
const personalApplicationPattern =
  /\b(?:your application|application id|case number|we received your application|your interview|missing documents for your application|deine bewerbung|ihre bewerbung|ihr antrag|dein antrag|aktenzeichen|vorgangsnummer|bewerbung.{0,40}eingegangen|(?:dein|ihr|your).{0,40}vorstellungsgespräch)\b/iu;

const assertAccessibleGmailMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const [selectedMailbox] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
    })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, "gmail")
      )
    )
    .limit(1);

  if (selectedMailbox === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  return selectedMailbox;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 2000)
    : "Unknown useful-details error.";

const getSenderSource = (from?: string | null) => {
  const domain = from?.match(
    /[A-Z0-9._%+-]+@(?<domain>[A-Z0-9.-]+\.[A-Z]{2,})/iu
  )?.groups?.domain;
  return hasText(domain) ? domain.toLowerCase().slice(0, 253) : null;
};

const serializeUsefulDetails = (
  items: {
    detail: typeof gmailUsefulDetail.$inferSelect;
    feedback: GmailUsefulDetailFeedbackSignal | null;
  }[]
): GmailUsefulDetailListItem[] => {
  const details: GmailUsefulDetailListItem[] = [];

  for (const { detail: item, feedback } of items) {
    if (
      SUPPRESSED_AUTOMATION_KINDS.has(item.kind) &&
      automatedEngineeringSenderPattern.test(item.source ?? "")
    ) {
      continue;
    }

    let code: string | null = null;
    if (hasText(item.encryptedCode)) {
      try {
        code = decryptSecret(item.encryptedCode);
      } catch (error) {
        reportError(error, { operation: "gmail-useful-details:decrypt-code" });
        continue;
      }
    }

    details.push({
      carrier: item.carrier,
      code,
      eventAt: item.eventAt,
      expectedAt: item.expectedAt,
      expiresAt: item.expiresAt,
      feedback,
      gmailMessageId: item.gmailMessageId,
      gmailThreadId: item.gmailThreadId,
      id: item.id,
      kind: item.kind,
      location: item.location,
      receivedAt: item.receivedAt,
      reference: item.reference,
      relevanceSource: item.relevanceSource,
      relevantFrom: item.relevantFrom,
      status: item.deliveryStatus,
      summary: item.summary,
      title: item.title,
      trackingNumber: item.trackingNumber,
    });
  }

  return details;
};

const trimText = (value: string | null, maxLength: number) => {
  const normalized = hasText(value)
    ? value.trim().replaceAll(/\s+/gu, " ")
    : null;
  if (!hasText(normalized)) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, maxLength).trimEnd();
  const lastWhitespaceIndex = sliced.search(/\s+\S*$/u);
  return lastWhitespaceIndex >= maxLength * 0.65
    ? sliced.slice(0, lastWhitespaceIndex).trimEnd()
    : sliced;
};

const getMessageReceivedAt = (message: AutomationMailMessage, now: Date) => {
  const internalTimestamp = Number(message.internalDate);
  const parsedTimestamp =
    Number.isFinite(internalTimestamp) && internalTimestamp > 0
      ? internalTimestamp
      : Date.parse(message.date ?? "");

  if (
    !Number.isFinite(parsedTimestamp) ||
    parsedTimestamp > now.getTime() + 1000 * 60 * 5
  ) {
    return now;
  }

  return new Date(parsedTimestamp);
};

const normalizeCode = (value: string | null) => {
  const code = (value ?? "").replaceAll(/\s+/gu, "").trim();
  return code.length >= 4 &&
    code.length <= 16 &&
    /^[A-Za-z0-9-]+$/u.test(code) &&
    /\d/u.test(code)
    ? code
    : null;
};

const verificationIntentPattern =
  /\b(?:2fa|authentication|authorize|confirm|identity|login|one[-\s]?time|otp|passcode|sign[-\s]?in|two[-\s]?factor|verification|verify)\b/iu;
const verificationCodePattern =
  /\b(?:code|otp|passcode|pin)\b[^A-Za-z0-9]{0,24}(?<code>[A-Z0-9]{4,16}|[A-Z0-9]+(?:[ -][A-Z0-9]+)+)\b/giu;
const numericVerificationCodePattern = /\b(?<code>\d(?:[ -]?\d){3,7})\b/gu;

const buildVerificationCodeSearchText = (message: AutomationMailMessage) =>
  [message.subject, message.snippet, message.bodyText, message.bodyHtml]
    .filter((part) => hasText(part))
    .join("\n")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/&(?:nbsp|#160);/giu, " ")
    .slice(0, 12_000);

const buildUsefulDetailRejectionText = (message: AutomationMailMessage) =>
  [
    message.from,
    message.subject,
    message.snippet,
    message.bodyText,
    message.bodyHtml,
  ]
    .filter((part) => hasText(part))
    .join("\n")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/&(?:nbsp|#160);/giu, " ")
    .slice(0, 12_000);

const isOverbroadUsefulDetail = (
  candidate: GmailUsefulDetailCandidate,
  message: AutomationMailMessage
) => {
  const text = buildUsefulDetailRejectionText(message);

  if (candidate.kind === "task") {
    return publicCallToActionPattern.test(text);
  }

  if (candidate.kind === "application") {
    return (
      publicOpportunityPattern.test(text) &&
      !personalApplicationPattern.test(text)
    );
  }

  return false;
};

const looksLikeVerificationContext = (
  text: string,
  index: number,
  length: number
) => {
  const window = text.slice(
    Math.max(0, index - 80),
    Math.min(text.length, index + length + 80)
  );
  return verificationIntentPattern.test(window);
};

const extractVerificationCodeFromMessage = (message: AutomationMailMessage) => {
  const text = buildVerificationCodeSearchText(message);
  if (!verificationIntentPattern.test(text)) {
    return null;
  }

  for (const match of text.matchAll(verificationCodePattern)) {
    const code = normalizeCode(match.groups?.code ?? null);
    if (
      code !== null &&
      looksLikeVerificationContext(text, match.index ?? 0, match[0].length)
    ) {
      return code;
    }
  }

  for (const match of text.matchAll(numericVerificationCodePattern)) {
    const code = normalizeCode(match.groups?.code ?? null);
    if (
      code !== null &&
      looksLikeVerificationContext(text, match.index ?? 0, match[0].length)
    ) {
      return code;
    }
  }

  return null;
};

const normalizeTrackingKey = (value: string) =>
  value.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");

const parseExpectedAt = (value: string | null) => {
  if (!hasText(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

const parseTimestamp = (value: string | null) => {
  if (!hasText(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

const normalizeReferenceKey = (value: string) =>
  value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, "")
    .slice(0, 120);

const defaultTitles = {
  application: "Application update",
  appointment: "Appointment",
  bill: "Payment due",
  delivery: "Delivery update",
  document_expiry: "Document expiring",
  reservation: "Reservation",
  return: "Return update",
  security_alert: "Security alert",
  task: "Task",
  travel: "Travel update",
  verification_code: "Verification code",
} as const satisfies Record<GmailUsefulDetailKind, string>;

const getVisibleFrom = ({
  eventAt,
  kind,
  receivedAt,
  relevantFrom,
}: {
  eventAt: Date | null;
  kind: GmailUsefulDetailKind;
  receivedAt: Date;
  relevantFrom: Date;
}) => {
  let visibleFrom = relevantFrom < receivedAt ? receivedAt : relevantFrom;
  const leadMs = EVENT_DETAIL_VISIBLE_LEAD_MS[kind];

  if (eventAt !== null && leadMs !== undefined && eventAt > visibleFrom) {
    const reminderStart = new Date(eventAt.getTime() - leadMs);
    if (visibleFrom < reminderStart) {
      visibleFrom = reminderStart;
    }
  }

  return visibleFrom;
};

export type MaterializedGmailUsefulDetail = {
  carrier: string | null;
  code: string | null;
  dedupeKey: string;
  eventAt: Date | null;
  expectedAt: Date | null;
  expiresAt: Date;
  kind: GmailUsefulDetailKind;
  location: string | null;
  receivedAt: Date;
  reference: string | null;
  relevanceSource: GmailUsefulDetailRelevanceSource;
  relevantFrom: Date;
  status: GmailDeliveryStatus | null;
  summary: string | null;
  title: string;
  trackingNumber: string | null;
} | null;

export type GmailUsefulDetailListItem = {
  carrier: string | null;
  code: string | null;
  eventAt: Date | null;
  expectedAt: Date | null;
  expiresAt: Date;
  feedback: GmailUsefulDetailFeedbackSignal | null;
  gmailMessageId: string;
  gmailThreadId: string | null;
  id: string;
  kind: GmailUsefulDetailKind;
  location: string | null;
  receivedAt: Date;
  reference: string | null;
  relevanceSource: GmailUsefulDetailRelevanceSource;
  relevantFrom: Date;
  status: GmailDeliveryStatus | null;
  summary: string | null;
  title: string;
  trackingNumber: string | null;
};

type MaterializedUsefulDetailKind = Exclude<
  GmailUsefulDetailCandidate["kind"],
  "none"
>;

const buildUsefulDetailDedupeKey = ({
  kind,
  messageId,
  normalizedReference,
  normalizedTrackingNumber,
  threadId,
}: {
  kind: GmailUsefulDetailKind;
  messageId: string;
  normalizedReference: string;
  normalizedTrackingNumber: string;
  threadId: string | null | undefined;
}) => {
  if (kind === "verification_code") {
    return `message:${messageId}`;
  }
  if (normalizedTrackingNumber !== "") {
    return `tracking:${normalizedTrackingNumber}`;
  }
  if (normalizedReference.length >= 4) {
    return `reference:${normalizedReference}`;
  }
  return `thread:${threadId ?? messageId}`;
};

const isEventKind = (kind: GmailUsefulDetailKind) =>
  kind === "appointment" ||
  kind === "bill" ||
  kind === "document_expiry" ||
  kind === "reservation" ||
  kind === "task" ||
  kind === "travel";

const hasUsefulDetailRelevanceSource = (
  relevanceSource: GmailUsefulDetailRelevanceSource | null | undefined
): relevanceSource is GmailUsefulDetailRelevanceSource =>
  hasText(relevanceSource);

const rejectInvalidUsefulDetailWindow = ({
  expiresAt,
  kind,
  now,
  receivedAt,
  relevanceSource,
  relevantFrom,
}: {
  expiresAt: Date | null;
  kind: MaterializedUsefulDetailKind;
  now: Date;
  receivedAt: Date;
  relevanceSource: GmailUsefulDetailRelevanceSource | null | undefined;
  relevantFrom: Date | null;
}) =>
  relevantFrom === null ||
  expiresAt === null ||
  expiresAt <= now ||
  relevantFrom >= expiresAt ||
  expiresAt.getTime() - receivedAt.getTime() > MAX_RELEVANCE_HORIZON_MS[kind] ||
  !hasUsefulDetailRelevanceSource(relevanceSource);

const rejectMissingUsefulDetailFields = ({
  candidate,
  carrier,
  eventAt,
  location,
  merchant,
  reference,
  summary,
  trackingNumber,
}: {
  candidate: GmailUsefulDetailCandidate & {
    kind: MaterializedUsefulDetailKind;
  };
  carrier: string | null;
  eventAt: Date | null;
  location: string | null;
  merchant: string | null;
  reference: string | null;
  summary: string | null;
  trackingNumber: string | null;
}) => {
  if (isEventKind(candidate.kind) && eventAt === null) {
    return true;
  }
  if (
    candidate.kind === "delivery" &&
    !hasText(carrier) &&
    !hasText(merchant) &&
    !hasText(trackingNumber) &&
    !hasText(summary)
  ) {
    return true;
  }
  return (
    candidate.kind !== "delivery" &&
    candidate.kind !== "verification_code" &&
    !hasText(summary) &&
    eventAt === null &&
    !hasText(reference) &&
    !hasText(location)
  );
};

const rejectUsefulDetailCandidateEarly = ({
  candidate,
  message,
  preferences,
}: {
  candidate: GmailUsefulDetailCandidate;
  message: AutomationMailMessage;
  preferences?: GmailUsefulDetailPreferenceProfile;
}) => {
  if (candidate.kind === "none" || candidate.confidence !== "high") {
    return true;
  }
  if (
    preferences !== undefined &&
    preferences.avoidKinds.includes(candidate.kind)
  ) {
    return true;
  }
  if (
    SUPPRESSED_AUTOMATION_KINDS.has(candidate.kind) &&
    automatedEngineeringSenderPattern.test(message.from ?? "")
  ) {
    return true;
  }
  return isOverbroadUsefulDetail(candidate, message);
};

const buildMaterializedUsefulDetailFields = ({
  candidate,
  expiresAt,
  message,
  receivedAt,
  relevantFrom,
  relevanceSource,
}: {
  candidate: GmailUsefulDetailCandidate & {
    kind: MaterializedUsefulDetailKind;
  };
  expiresAt: Date;
  message: AutomationMailMessage;
  receivedAt: Date;
  relevantFrom: Date;
  relevanceSource: GmailUsefulDetailRelevanceSource;
}): MaterializedGmailUsefulDetail => {
  const code =
    candidate.kind === "verification_code"
      ? normalizeCode(candidate.code)
      : null;
  if (candidate.kind === "verification_code" && code === null) {
    return null;
  }

  const carrier = trimText(candidate.carrier, 80);
  const merchant = trimText(candidate.merchant, 80);
  const trackingNumber =
    candidate.kind === "delivery"
      ? trimText(candidate.trackingNumber, 80)
      : null;
  const normalizedTrackingNumber = hasText(trackingNumber)
    ? normalizeTrackingKey(trackingNumber)
    : "";
  const expectedAt =
    candidate.kind === "delivery"
      ? parseExpectedAt(candidate.expectedAt)
      : null;
  const summary = trimText(candidate.summary, 160);
  const reference = trimText(candidate.reference, 120);
  const location = trimText(candidate.location, 160);
  const eventAt = parseTimestamp(candidate.eventAt) ?? expectedAt;
  const visibleFrom = getVisibleFrom({
    eventAt,
    kind: candidate.kind,
    receivedAt,
    relevantFrom,
  });
  const status =
    candidate.kind === "delivery" ? (candidate.status ?? "unknown") : null;
  if (visibleFrom >= expiresAt) {
    return null;
  }
  if (
    rejectMissingUsefulDetailFields({
      candidate,
      carrier,
      eventAt,
      location,
      merchant,
      reference,
      summary,
      trackingNumber,
    })
  ) {
    return null;
  }

  const normalizedReference = hasText(reference)
    ? normalizeReferenceKey(reference)
    : "";
  const dedupeKey = buildUsefulDetailDedupeKey({
    kind: candidate.kind,
    messageId: message.id,
    normalizedReference,
    normalizedTrackingNumber,
    threadId: message.threadId,
  });

  return {
    carrier,
    code,
    dedupeKey,
    eventAt,
    expectedAt,
    expiresAt,
    kind: candidate.kind,
    location,
    receivedAt,
    reference,
    relevanceSource,
    relevantFrom: visibleFrom,
    status,
    summary,
    title:
      trimText(candidate.service, 80) ??
      merchant ??
      carrier ??
      defaultTitles[candidate.kind],
    trackingNumber,
  };
};

export const materializeGmailUsefulDetail = ({
  candidate,
  message,
  now = new Date(),
  preferences,
}: {
  candidate: GmailUsefulDetailCandidate;
  message: AutomationMailMessage;
  now?: Date;
  preferences?: GmailUsefulDetailPreferenceProfile;
}): MaterializedGmailUsefulDetail => {
  const receivedAt = getMessageReceivedAt(message, now);
  if (rejectUsefulDetailCandidateEarly({ candidate, message, preferences })) {
    return null;
  }
  if (candidate.kind === "none") {
    return null;
  }

  const relevantFrom = parseTimestamp(candidate.relevantFrom);
  const expiresAt = parseTimestamp(candidate.relevantUntil);
  const { relevanceSource } = candidate;
  if (
    rejectInvalidUsefulDetailWindow({
      expiresAt,
      kind: candidate.kind,
      now,
      receivedAt,
      relevanceSource,
      relevantFrom,
    })
  ) {
    return null;
  }
  if (relevantFrom === null || expiresAt === null) {
    return null;
  }
  if (!hasUsefulDetailRelevanceSource(relevanceSource)) {
    return null;
  }

  return buildMaterializedUsefulDetailFields({
    candidate: { ...candidate, kind: candidate.kind },
    expiresAt,
    message,
    receivedAt,
    relevanceSource,
    relevantFrom,
  });
};

export const materializeGmailVerificationCode = ({
  message,
  now = new Date(),
}: {
  message: AutomationMailMessage;
  now?: Date;
}): MaterializedGmailUsefulDetail => {
  const code = extractVerificationCodeFromMessage(message);
  if (code === null) {
    return null;
  }

  const receivedAt = getMessageReceivedAt(message, now);
  const expiresAt = new Date(
    receivedAt.getTime() + MAX_RELEVANCE_HORIZON_MS.verification_code
  );
  if (expiresAt <= now) {
    return null;
  }

  return {
    carrier: null,
    code,
    dedupeKey: `message:${message.id}`,
    eventAt: null,
    expectedAt: null,
    expiresAt,
    kind: "verification_code",
    location: null,
    receivedAt,
    reference: null,
    relevanceSource: "inferred",
    relevantFrom: receivedAt,
    status: null,
    summary: null,
    title:
      trimText(message.from ?? null, 80) ?? defaultTitles.verification_code,
    trackingNumber: null,
  };
};

export const isGmailUsefulDetailCandidate = (
  message: AutomationMailMessage | null
): message is AutomationMailMessage => {
  if (message === null || message.labelIds === undefined) {
    return false;
  }
  return (
    message.labelIds.includes(MAILBOX_LABELS.inbox) &&
    !message.labelIds.some((labelId) => excludedLabels.has(labelId))
  );
};

const getOrCreateEvent = async (mailboxId: string, gmailMessageId: string) => {
  const now = new Date();
  await db
    .insert(gmailUsefulDetailEvent)
    .values({
      createdAt: now,
      gmailMessageId,
      id: randomUUID(),
      mailboxId,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [event] = await db
    .select()
    .from(gmailUsefulDetailEvent)
    .where(
      and(
        eq(gmailUsefulDetailEvent.mailboxId, mailboxId),
        eq(gmailUsefulDetailEvent.gmailMessageId, gmailMessageId)
      )
    )
    .limit(1);

  if (event === undefined) {
    throw new Error("Could not create useful-details event.");
  }

  return event;
};

const getMailboxOrganizationId = async (mailboxId: string) => {
  const [record] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);

  return record?.organizationId ?? null;
};

const deferEventAutomation = async (eventId: string, message: string) => {
  const now = new Date();
  await db
    .update(gmailUsefulDetailEvent)
    .set({
      lastError: message,
      nextAttemptAt: new Date(now.getTime() + BUDGET_RETRY_MS),
      updatedAt: now,
    })
    .where(eq(gmailUsefulDetailEvent.id, eventId));
};

const reportUsage = async (event: {
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  id: string;
  mailboxId: string;
  model: string | null;
  promptTokens: number | null;
  usageReportedAt: Date | null;
  userId: string;
}) => {
  const model = chatModelSchema.safeParse(event.model);
  if (
    event.usageReportedAt ||
    !model.success ||
    event.promptTokens === null ||
    event.promptTokens === undefined ||
    event.completionTokens === null ||
    event.completionTokens === undefined ||
    event.costUsd === null ||
    event.costUsd === undefined
  ) {
    return;
  }

  try {
    await reportAiUsage({
      completionTokens: event.completionTokens,
      costUsd: event.costUsd,
      externalId: event.id,
      mailboxId: event.mailboxId,
      model: model.data,
      promptTokens: event.promptTokens,
      promptTokensDetails: {
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
        cachedTokens: event.cachedTokens ?? 0,
      },
      usageKind: "usefulDetails",
      userId: event.userId,
    });
    await db
      .update(gmailUsefulDetailEvent)
      .set({
        lastError: null,
        updatedAt: new Date(),
        usageReportedAt: new Date(),
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));
  } catch (error) {
    await db
      .update(gmailUsefulDetailEvent)
      .set({
        lastError: `AI usage reporting failed: ${getErrorMessage(error)}`,
        updatedAt: new Date(),
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));
  }
};

const upsertGmailUsefulDetail = async ({
  detail,
  event,
  gmailMessageId,
  message,
  model,
  usage,
  source,
}: {
  detail: NonNullable<MaterializedGmailUsefulDetail>;
  event: typeof gmailUsefulDetailEvent.$inferSelect;
  gmailMessageId: string;
  message: AutomationMailMessage;
  model: string | null;
  source: string | null;
  usage: {
    cachedTokens: number | null;
    cacheWriteTokens: number | null;
    completionTokens: number | null;
    costUsd: number | null;
    promptTokens: number | null;
  };
}) => {
  const now = new Date();
  const encryptedCode = hasText(detail.code)
    ? encryptSecret(detail.code)
    : null;
  await db.transaction(async (tx) => {
    await tx
      .insert(gmailUsefulDetail)
      .values({
        carrier: detail.carrier,
        createdAt: now,
        dedupeKey: detail.dedupeKey,
        deliveryStatus: detail.status,
        encryptedCode,
        eventAt: detail.eventAt,
        expectedAt: detail.expectedAt,
        expiresAt: detail.expiresAt,
        gmailMessageId,
        gmailThreadId: message.threadId ?? null,
        id: randomUUID(),
        kind: detail.kind,
        location: detail.location,
        mailboxId: event.mailboxId,
        receivedAt: detail.receivedAt,
        reference: detail.reference,
        relevanceSource: detail.relevanceSource,
        relevantFrom: detail.relevantFrom,
        source,
        summary: detail.summary,
        title: detail.title,
        trackingNumber: detail.trackingNumber,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          carrier: detail.carrier,
          deliveryStatus: detail.status,
          encryptedCode,
          eventAt: detail.eventAt,
          expectedAt: detail.expectedAt,
          expiresAt: detail.expiresAt,
          gmailMessageId,
          gmailThreadId: message.threadId ?? null,
          location: detail.location,
          receivedAt: detail.receivedAt,
          reference: detail.reference,
          relevanceSource: detail.relevanceSource,
          relevantFrom: detail.relevantFrom,
          source,
          summary: detail.summary,
          title: detail.title,
          trackingNumber: detail.trackingNumber,
          updatedAt: now,
        },
        target: [
          gmailUsefulDetail.mailboxId,
          gmailUsefulDetail.kind,
          gmailUsefulDetail.dedupeKey,
        ],
      });
    await tx
      .update(gmailUsefulDetailEvent)
      .set({
        cacheWriteTokens: usage.cacheWriteTokens,
        cachedTokens: usage.cachedTokens,
        completionTokens: usage.completionTokens,
        costUsd: usage.costUsd,
        lastError: null,
        model,
        nextAttemptAt: null,
        processedAt: now,
        promptTokens: usage.promptTokens,
        updatedAt: now,
        usageReportedAt: hasText(model) ? null : now,
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));
  });
  return {
    ...event,
    cacheWriteTokens: usage.cacheWriteTokens,
    cachedTokens: usage.cachedTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd,
    model,
    processedAt: now,
    promptTokens: usage.promptTokens,
    usageReportedAt: hasText(model) ? event.usageReportedAt : now,
  };
};

const markEventProcessedWithoutUsage = async (eventId: string) => {
  const now = new Date();
  await db
    .update(gmailUsefulDetailEvent)
    .set({
      lastError: null,
      nextAttemptAt: null,
      processedAt: now,
      updatedAt: now,
      usageReportedAt: now,
    })
    .where(eq(gmailUsefulDetailEvent.id, eventId));
};

type GmailUsefulDetailFeedbackCount = {
  count: number;
  kind: GmailUsefulDetailKind;
  signal: GmailUsefulDetailFeedbackSignal;
};

const getFeedbackTotals = (
  rows: GmailUsefulDetailFeedbackCount[],
  kind: GmailUsefulDetailKind
) => {
  let notUseful = 0;
  let useful = 0;

  for (const row of rows) {
    if (row.kind !== kind) {
      continue;
    }
    if (row.signal === "useful") {
      useful += row.count;
    } else {
      notUseful += row.count;
    }
  }

  return { notUseful, total: useful + notUseful, useful };
};

export const buildGmailUsefulDetailPreferenceProfile = ({
  global,
  source,
}: {
  global: GmailUsefulDetailFeedbackCount[];
  source: GmailUsefulDetailFeedbackCount[];
}): GmailUsefulDetailPreferenceProfile => {
  const avoidKinds: GmailUsefulDetailKind[] = [];
  const preferKinds: GmailUsefulDetailKind[] = [];

  for (const kind of USEFUL_DETAIL_KINDS) {
    const sourceTotals = getFeedbackTotals(source, kind);
    const globalTotals = getFeedbackTotals(global, kind);
    const sourceAvoids =
      sourceTotals.notUseful > sourceTotals.useful &&
      sourceTotals.notUseful / sourceTotals.total >= 0.67;
    const sourcePrefers =
      sourceTotals.useful >= 2 &&
      sourceTotals.useful > sourceTotals.notUseful &&
      sourceTotals.useful / sourceTotals.total >= 0.67;
    const globalAvoids =
      globalTotals.notUseful >= 3 &&
      globalTotals.notUseful / globalTotals.total >= 0.75;
    const globalPrefers =
      globalTotals.useful >= 3 &&
      globalTotals.useful / globalTotals.total >= 0.75;

    if (sourceAvoids || (!sourcePrefers && globalAvoids)) {
      avoidKinds.push(kind);
    } else if (sourcePrefers || globalPrefers) {
      preferKinds.push(kind);
    }
  }

  return { avoidKinds, preferKinds };
};

const getGmailUsefulDetailPreferenceProfile = async (
  mailboxId: string,
  source: string | null,
  userId: string,
  message: AutomationMailMessage
): Promise<{
  model: ChatModel;
  preferences: GmailUsefulDetailPreferenceProfile;
}> => {
  const [aiConfiguration, feedbackPolicies, memoryContext] = await Promise.all([
    loadAiConfiguration({ userId }),
    loadUsefulDetailFeedbackPolicies({ mailboxId, source }),
    loadAiAgentContext({
      agent: "useful_detail",
      includeUserScope: false,
      mailboxId,
      query: buildMailMemoryQuery(message),
      userId,
    }),
  ]);

  return {
    model: aiConfiguration.usefulDetailModel,
    preferences: {
      avoidKinds: USEFUL_DETAIL_KINDS.filter(
        (kind) => feedbackPolicies.get(kind) === "suppress"
      ),
      memoryContext: serializeAiAgentContext(memoryContext),
      preferKinds: USEFUL_DETAIL_KINDS.filter(
        (kind) => feedbackPolicies.get(kind) === "prefer"
      ),
    },
  };
};

export const processGmailUsefulDetailMessage = async ({
  gmailMessageId,
  loadMessage,
  mailboxId,
  organizationId,
  userId,
}: {
  gmailMessageId: string;
  loadMessage: () => Promise<AutomationMailMessage | null>;
  mailboxId: string;
  organizationId?: string | null;
  userId: string;
}) => {
  let event = await getOrCreateEvent(mailboxId, gmailMessageId);
  if (event.processedAt) {
    await reportUsage({ ...event, userId });
    return;
  }

  try {
    const message = await loadMessage();
    if (!isGmailUsefulDetailCandidate(message)) {
      await markEventProcessedWithoutUsage(event.id);
      return;
    }

    let promptTokens = 0;
    let completionTokens = 0;
    let costUsd: number | undefined = 0;
    let cachedTokens = 0;
    let cacheWriteTokens = 0;
    const usageMiddleware: ChatMiddleware = {
      name: "gmail-useful-details-usage",
      onUsage: (_context, usage) => {
        promptTokens += usage.promptTokens;
        completionTokens += usage.completionTokens;
        costUsd =
          costUsd === undefined || usage.cost === undefined
            ? undefined
            : costUsd + usage.cost;
        cachedTokens += usage.promptTokensDetails?.cachedTokens ?? 0;
        cacheWriteTokens += usage.promptTokensDetails?.cacheWriteTokens ?? 0;
      },
    };
    const source = getSenderSource(message.from);
    const [[currentSettings], preferenceSettings] = await Promise.all([
      db
        .select({ enabled: mailboxAutomationSettings.usefulDetailsEnabled })
        .from(mailboxAutomationSettings)
        .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
        .limit(1),
      getGmailUsefulDetailPreferenceProfile(mailboxId, source, userId, message),
    ]);
    const { model, preferences } = preferenceSettings;
    if (!currentSettings?.enabled) {
      await markEventProcessedWithoutUsage(event.id);
      return;
    }
    if (preferences.avoidKinds.length === USEFUL_DETAIL_KINDS.length) {
      await markEventProcessedWithoutUsage(event.id);
      return;
    }

    const verificationCode = preferences.avoidKinds.includes(
      "verification_code"
    )
      ? null
      : materializeGmailVerificationCode({ message });
    if (verificationCode) {
      event = await upsertGmailUsefulDetail({
        detail: verificationCode,
        event,
        gmailMessageId,
        message,
        model: null,
        source,
        usage: {
          cacheWriteTokens: null,
          cachedTokens: null,
          completionTokens: null,
          costUsd: null,
          promptTokens: null,
        },
      });
      return;
    }

    const budgetStatus = await getMailAutomationAiBudgetStatus({
      organizationId:
        organizationId ?? (await getMailboxOrganizationId(mailboxId)),
      userId,
    });
    if (!budgetStatus.allowed) {
      await deferEventAutomation(event.id, budgetStatus.message);
      return;
    }

    const candidate = await extractMailUsefulDetail({
      message,
      middleware: [usageMiddleware],
      model,
      preferences,
    });
    const detail = materializeGmailUsefulDetail({
      candidate,
      message,
      preferences,
    });
    const now = new Date();
    const eventUpdate = db
      .update(gmailUsefulDetailEvent)
      .set({
        cacheWriteTokens,
        cachedTokens,
        completionTokens,
        costUsd: costUsd ?? null,
        lastError: null,
        model,
        nextAttemptAt: null,
        processedAt: now,
        promptTokens,
        updatedAt: now,
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));

    if (detail) {
      event = await upsertGmailUsefulDetail({
        detail,
        event,
        gmailMessageId,
        message,
        model,
        source,
        usage: {
          cacheWriteTokens,
          cachedTokens,
          completionTokens,
          costUsd: costUsd ?? null,
          promptTokens,
        },
      });
      const [latestSettings] = await db
        .select({ enabled: mailboxAutomationSettings.usefulDetailsEnabled })
        .from(mailboxAutomationSettings)
        .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
        .limit(1);
      if (!latestSettings?.enabled) {
        await db
          .delete(gmailUsefulDetail)
          .where(eq(gmailUsefulDetail.mailboxId, mailboxId));
      }
    } else {
      const [processed] = await eventUpdate.returning();
      event = processed ?? event;
    }

    await reportUsage({ ...event, userId });
  } catch (error) {
    const now = new Date();
    const attemptCount = event.attemptCount + 1;
    await db
      .update(gmailUsefulDetailEvent)
      .set({
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: new Date(
          now.getTime() +
            Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attemptCount - 1))
        ),
        updatedAt: now,
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));
    reportError(error, { operation: "gmail-useful-details:extract" });
  }
};

export const listPendingGmailUsefulDetailMessageIds = async (
  mailboxId: string
) => {
  const now = new Date();
  const events = await db
    .select({ gmailMessageId: gmailUsefulDetailEvent.gmailMessageId })
    .from(gmailUsefulDetailEvent)
    .where(
      and(
        eq(gmailUsefulDetailEvent.mailboxId, mailboxId),
        isNull(gmailUsefulDetailEvent.processedAt),
        or(
          isNull(gmailUsefulDetailEvent.nextAttemptAt),
          lte(gmailUsefulDetailEvent.nextAttemptAt, now)
        )
      )
    )
    .limit(20);

  return events.map((event) => event.gmailMessageId);
};

export const reportPendingGmailUsefulDetailUsage = async (
  mailboxId: string,
  userId: string
) => {
  const events = await db
    .select({
      cacheWriteTokens: gmailUsefulDetailEvent.cacheWriteTokens,
      cachedTokens: gmailUsefulDetailEvent.cachedTokens,
      completionTokens: gmailUsefulDetailEvent.completionTokens,
      costUsd: gmailUsefulDetailEvent.costUsd,
      id: gmailUsefulDetailEvent.id,
      model: gmailUsefulDetailEvent.model,
      promptTokens: gmailUsefulDetailEvent.promptTokens,
      usageReportedAt: gmailUsefulDetailEvent.usageReportedAt,
    })
    .from(gmailUsefulDetailEvent)
    .where(
      and(
        eq(gmailUsefulDetailEvent.mailboxId, mailboxId),
        isNull(gmailUsefulDetailEvent.usageReportedAt)
      )
    )
    .limit(100);

  await Promise.all(
    events.map(async (event) => {
      await reportUsage({ ...event, mailboxId, userId });
    })
  );
};

export const listGmailUsefulDetails = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertAccessibleGmailMailbox(input);
  const [[settings], entitlement] = await Promise.all([
    db
      .select({ enabled: mailboxAutomationSettings.usefulDetailsEnabled })
      .from(mailboxAutomationSettings)
      .where(eq(mailboxAutomationSettings.mailboxId, input.mailboxId))
      .limit(1),
    hasUserBillingFeature({
      feature: "gmailAutomation",
      organizationId: selectedMailbox.organizationId ?? undefined,
      userId: input.userId,
    }),
  ]);
  const enabled = (settings?.enabled ?? false) && entitlement.hasAccess;
  if (!enabled) {
    return {
      enabled,
      items: [] as GmailUsefulDetailListItem[],
      nextRelevantAt: null as Date | null,
    };
  }

  const now = new Date();
  const [items, [nextItem]] = await Promise.all([
    db
      .select({
        detail: gmailUsefulDetail,
        feedback: gmailUsefulDetailFeedback.signal,
      })
      .from(gmailUsefulDetail)
      .leftJoin(
        gmailUsefulDetailFeedback,
        and(
          eq(gmailUsefulDetailFeedback.mailboxId, gmailUsefulDetail.mailboxId),
          eq(gmailUsefulDetailFeedback.detailId, gmailUsefulDetail.id)
        )
      )
      .where(
        and(
          eq(gmailUsefulDetail.mailboxId, input.mailboxId),
          isNull(gmailUsefulDetail.dismissedAt),
          lte(gmailUsefulDetail.relevantFrom, now),
          gt(gmailUsefulDetail.expiresAt, now)
        )
      )
      .orderBy(asc(gmailUsefulDetail.expiresAt))
      .limit(6),
    db
      .select({ relevantFrom: gmailUsefulDetail.relevantFrom })
      .from(gmailUsefulDetail)
      .where(
        and(
          eq(gmailUsefulDetail.mailboxId, input.mailboxId),
          isNull(gmailUsefulDetail.dismissedAt),
          gt(gmailUsefulDetail.relevantFrom, now),
          gt(gmailUsefulDetail.expiresAt, now)
        )
      )
      .orderBy(asc(gmailUsefulDetail.relevantFrom))
      .limit(1),
  ]);

  return {
    enabled,
    items: serializeUsefulDetails(items),
    nextRelevantAt: nextItem?.relevantFrom ?? null,
  };
};

export const listGmailThreadUsefulDetails = async (input: {
  gmailThreadId: string;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertAccessibleGmailMailbox(input);
  const [[settings], entitlement] = await Promise.all([
    db
      .select({ enabled: mailboxAutomationSettings.usefulDetailsEnabled })
      .from(mailboxAutomationSettings)
      .where(eq(mailboxAutomationSettings.mailboxId, input.mailboxId))
      .limit(1),
    hasUserBillingFeature({
      feature: "gmailAutomation",
      organizationId: selectedMailbox.organizationId ?? undefined,
      userId: input.userId,
    }),
  ]);
  if (!(settings?.enabled ?? false) || !entitlement.hasAccess) {
    return [];
  }

  const items = await db
    .select({
      detail: gmailUsefulDetail,
      feedback: gmailUsefulDetailFeedback.signal,
    })
    .from(gmailUsefulDetail)
    .leftJoin(
      gmailUsefulDetailFeedback,
      and(
        eq(gmailUsefulDetailFeedback.mailboxId, gmailUsefulDetail.mailboxId),
        eq(gmailUsefulDetailFeedback.detailId, gmailUsefulDetail.id)
      )
    )
    .where(
      and(
        eq(gmailUsefulDetail.mailboxId, input.mailboxId),
        eq(gmailUsefulDetail.gmailThreadId, input.gmailThreadId),
        isNull(gmailUsefulDetail.dismissedAt)
      )
    )
    .orderBy(asc(gmailUsefulDetail.receivedAt));

  return serializeUsefulDetails(items);
};

export const dismissGmailUsefulDetail = async (input: {
  id: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertAccessibleGmailMailbox(input);
  const [dismissed] = await db
    .update(gmailUsefulDetail)
    .set({ dismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(gmailUsefulDetail.id, input.id),
        eq(gmailUsefulDetail.mailboxId, input.mailboxId)
      )
    )
    .returning({ id: gmailUsefulDetail.id });

  if (dismissed === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Useful detail not found." });
  }

  return { dismissed: true, id: dismissed.id };
};

export const setGmailUsefulDetailFeedback = async (input: {
  feedback: GmailUsefulDetailFeedbackSignal;
  id: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertAccessibleGmailMailbox(input);
  const [detail] = await db
    .select({
      id: gmailUsefulDetail.id,
      kind: gmailUsefulDetail.kind,
      source: gmailUsefulDetail.source,
    })
    .from(gmailUsefulDetail)
    .where(
      and(
        eq(gmailUsefulDetail.id, input.id),
        eq(gmailUsefulDetail.mailboxId, input.mailboxId)
      )
    )
    .limit(1);

  if (detail === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Useful detail not found." });
  }

  const now = new Date();
  await db
    .insert(gmailUsefulDetailFeedback)
    .values({
      createdAt: now,
      detailId: detail.id,
      id: randomUUID(),
      kind: detail.kind,
      mailboxId: input.mailboxId,
      signal: input.feedback,
      source: detail.source,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        kind: detail.kind,
        signal: input.feedback,
        source: detail.source,
        updatedAt: now,
      },
      target: [
        gmailUsefulDetailFeedback.mailboxId,
        gmailUsefulDetailFeedback.detailId,
      ],
    });

  if (input.feedback === "not_useful") {
    await db
      .update(gmailUsefulDetail)
      .set({ dismissedAt: now, updatedAt: now })
      .where(eq(gmailUsefulDetail.id, detail.id));
  }

  void (async () => {
    try {
      await refreshUsefulDetailMemoryProfile(input.mailboxId, input.userId);
    } catch (error: unknown) {
      reportError(error, {
        operation: "gmail-useful-details:refresh-memory",
      });
    }
  })();
  void (async () => {
    try {
      await recordAndRefreshAiMemory({
        kind: "useful_detail_feedback",
        mailboxId: input.mailboxId,
        metadata: {
          detailKind: detail.kind,
          signal: input.feedback,
          source: detail.source,
        },
        userId: input.userId,
      });
    } catch (error: unknown) {
      reportError(error, {
        operation: "gmail-useful-details:learn-feedback",
      });
    }
  })();

  return { feedback: input.feedback, id: detail.id };
};
