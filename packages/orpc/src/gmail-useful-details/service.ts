import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import type { ChatMiddleware } from "@tanstack/ai";
import { ORPCError } from "@orpc/server";
import {
  extractMailUsefulDetail,
  GMAIL_USEFUL_DETAIL_MODEL,
  type GmailUsefulDetailCandidate,
  type GmailUsefulDetailPreferenceProfile,
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
  type GmailDeliveryStatus,
  type GmailUsefulDetailFeedbackSignal,
  type GmailUsefulDetailKind,
  type GmailUsefulDetailRelevanceSource,
} from "@quieter/database/schema";
import { MAILBOX_LABELS } from "@quieter/gmail";
import { and, asc, count, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "../gmail-mailbox-access";
import {
  loadAutomationMemoryPrompt,
  refreshUsefulDetailMemoryProfile,
} from "../mail-automation/memory";
import { loadUserAiContextPrompt, recordAndRefreshUserAiContext } from "../user-ai-context";

const RETRY_BASE_MS = 1000 * 60 * 5;
const RETRY_MAX_MS = 1000 * 60 * 60 * 24;
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
const EVENT_DETAIL_VISIBLE_LEAD_MS: Partial<Record<GmailUsefulDetailKind, number>> = {
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
  /(?:^|[.@<\s-])(github|gitlab|bitbucket|jira|linear|sentry|coderabbit|vercel|datadog|buildkite|circleci)(?:[.@>\s-]|$)/i;
const SUPPRESSED_AUTOMATION_KINDS = new Set<GmailUsefulDetailKind>([
  "application",
  "security_alert",
  "task",
]);
const publicCallToActionPattern =
  /\b(vote (?:now|today|by|before|for)|cast your vote|sign (?:the )?petition|donate (?:now|today|by|before|to)|fundraiser|abstimm(?:en|ung).{0,40}(?:heute|bis|f.r)|wahl.{0,40}(?:heute|bis|f.r)|spenden.{0,40}(?:jetzt|heute|bis|f.r))\b/i;
const publicOpportunityPattern =
  /\b(job posting|vacancy|open position|position opening|call for applications|applications? (?:are )?open|apply now|bewerbungsfrist|stellenausschreibung|stellenangebot|ausschreibung|scholarship|stipendium)\b/i;
const personalApplicationPattern =
  /\b(your application|application id|case number|we received your application|your interview|missing documents for your application|deine bewerbung|ihre bewerbung|ihr antrag|dein antrag|aktenzeichen|vorgangsnummer|bewerbung.{0,40}eingegangen|(?:dein|ihr|your).{0,40}vorstellungsgespr.ch)\b/i;

const assertAccessibleGmailMailbox = async (input: { mailboxId: string; userId: string }) => {
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
        eq(mailbox.provider, "gmail"),
      ),
    )
    .limit(1);

  if (!selectedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  return selectedMailbox;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 2_000) : "Unknown useful-details error.";

const getSenderSource = (from?: string | null) => {
  const domain = from?.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  return domain?.toLowerCase().slice(0, 253) ?? null;
};

const serializeUsefulDetails = async (
  items: {
    detail: typeof gmailUsefulDetail.$inferSelect;
    feedback: GmailUsefulDetailFeedbackSignal | null;
  }[],
): Promise<GmailUsefulDetailListItem[]> => {
  const details: GmailUsefulDetailListItem[] = [];

  for (const { detail: item, feedback } of items) {
    if (
      SUPPRESSED_AUTOMATION_KINDS.has(item.kind) &&
      automatedEngineeringSenderPattern.test(item.source ?? "")
    ) {
      continue;
    }

    let code: string | null = null;
    if (item.encryptedCode) {
      try {
        code = decryptSecret(item.encryptedCode);
      } catch (error) {
        console.error(`Could not decrypt useful detail ${item.id}.`, getErrorMessage(error));
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
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, maxLength).trimEnd();
  const lastWhitespaceIndex = sliced.search(/\s+\S*$/);
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

  if (!Number.isFinite(parsedTimestamp) || parsedTimestamp > now.getTime() + 1000 * 60 * 5) {
    return now;
  }

  return new Date(parsedTimestamp);
};

const normalizeCode = (value: string | null) => {
  const code = value?.replace(/\s+/g, "").trim() ?? "";
  return code.length >= 4 && code.length <= 16 && /^[A-Za-z0-9-]+$/.test(code) && /\d/.test(code)
    ? code
    : null;
};

const verificationIntentPattern =
  /\b(2fa|authentication|authorize|confirm|identity|login|one[-\s]?time|otp|passcode|sign[-\s]?in|two[-\s]?factor|verification|verify)\b/i;
const verificationCodePattern =
  /\b(?:code|otp|passcode|pin)\b[^A-Za-z0-9]{0,24}([A-Z0-9]{4,16}|[A-Z0-9]+(?:[ -][A-Z0-9]+)+)\b/gi;
const numericVerificationCodePattern = /\b(\d(?:[ -]?\d){3,7})\b/g;

const buildVerificationCodeSearchText = (message: AutomationMailMessage) =>
  [message.subject, message.snippet, message.bodyText, message.bodyHtml]
    .filter(Boolean)
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .slice(0, 12_000);

const buildUsefulDetailRejectionText = (message: AutomationMailMessage) =>
  [message.from, message.subject, message.snippet, message.bodyText, message.bodyHtml]
    .filter(Boolean)
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .slice(0, 12_000);

const isOverbroadUsefulDetail = (
  candidate: GmailUsefulDetailCandidate,
  message: AutomationMailMessage,
) => {
  const text = buildUsefulDetailRejectionText(message);

  if (candidate.kind === "task") {
    return publicCallToActionPattern.test(text);
  }

  if (candidate.kind === "application") {
    return publicOpportunityPattern.test(text) && !personalApplicationPattern.test(text);
  }

  return false;
};

const looksLikeVerificationContext = (text: string, index: number, length: number) => {
  const window = text.slice(Math.max(0, index - 80), Math.min(text.length, index + length + 80));
  return verificationIntentPattern.test(window);
};

const extractVerificationCodeFromMessage = (message: AutomationMailMessage) => {
  const text = buildVerificationCodeSearchText(message);
  if (!verificationIntentPattern.test(text)) {
    return null;
  }

  for (const match of text.matchAll(verificationCodePattern)) {
    const code = normalizeCode(match[1] ?? null);
    if (code && looksLikeVerificationContext(text, match.index ?? 0, match[0].length)) {
      return code;
    }
  }

  for (const match of text.matchAll(numericVerificationCodePattern)) {
    const code = normalizeCode(match[1] ?? null);
    if (code && looksLikeVerificationContext(text, match.index ?? 0, match[0].length)) {
      return code;
    }
  }

  return null;
};

const normalizeTrackingKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const parseExpectedAt = (value: string | null) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

const parseTimestamp = (value: string | null) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

const normalizeReferenceKey = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
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

  if (eventAt && leadMs && eventAt > visibleFrom) {
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
  if (candidate.kind === "none" || candidate.confidence !== "high") {
    return null;
  }
  if (preferences?.avoidKinds.includes(candidate.kind)) {
    return null;
  }
  if (
    SUPPRESSED_AUTOMATION_KINDS.has(candidate.kind) &&
    automatedEngineeringSenderPattern.test(message.from ?? "")
  ) {
    return null;
  }
  if (isOverbroadUsefulDetail(candidate, message)) {
    return null;
  }

  const relevantFrom = parseTimestamp(candidate.relevantFrom);
  const expiresAt = parseTimestamp(candidate.relevantUntil);
  if (
    !relevantFrom ||
    !expiresAt ||
    expiresAt <= now ||
    relevantFrom >= expiresAt ||
    expiresAt.getTime() - receivedAt.getTime() > MAX_RELEVANCE_HORIZON_MS[candidate.kind] ||
    !candidate.relevanceSource
  ) {
    return null;
  }
  const code = candidate.kind === "verification_code" ? normalizeCode(candidate.code) : null;
  if (candidate.kind === "verification_code" && !code) {
    return null;
  }

  const carrier = trimText(candidate.carrier, 80);
  const merchant = trimText(candidate.merchant, 80);
  const trackingNumber =
    candidate.kind === "delivery" ? trimText(candidate.trackingNumber, 80) : null;
  const normalizedTrackingNumber = trackingNumber ? normalizeTrackingKey(trackingNumber) : "";
  const expectedAt = candidate.kind === "delivery" ? parseExpectedAt(candidate.expectedAt) : null;
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
  const status = candidate.kind === "delivery" ? (candidate.status ?? "unknown") : null;
  if (visibleFrom >= expiresAt) {
    return null;
  }
  if (
    (candidate.kind === "appointment" ||
      candidate.kind === "bill" ||
      candidate.kind === "document_expiry" ||
      candidate.kind === "reservation" ||
      candidate.kind === "task" ||
      candidate.kind === "travel") &&
    !eventAt
  ) {
    return null;
  }
  if (candidate.kind === "delivery" && !carrier && !merchant && !trackingNumber && !summary) {
    return null;
  }
  if (
    candidate.kind !== "delivery" &&
    candidate.kind !== "verification_code" &&
    !summary &&
    !eventAt &&
    !reference &&
    !location
  ) {
    return null;
  }

  const normalizedReference = reference ? normalizeReferenceKey(reference) : "";
  const dedupeKey =
    candidate.kind === "verification_code"
      ? `message:${message.id}`
      : normalizedTrackingNumber
        ? `tracking:${normalizedTrackingNumber}`
        : normalizedReference.length >= 4
          ? `reference:${normalizedReference}`
          : `thread:${message.threadId ?? message.id}`;

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
    relevanceSource: candidate.relevanceSource,
    relevantFrom: visibleFrom,
    status,
    summary,
    title: trimText(candidate.service, 80) ?? merchant ?? carrier ?? defaultTitles[candidate.kind],
    trackingNumber,
  };
};

export const materializeGmailVerificationCode = ({
  message,
  now = new Date(),
}: {
  message: AutomationMailMessage;
  now?: Date;
}): MaterializedGmailUsefulDetail => {
  const code = extractVerificationCodeFromMessage(message);
  if (!code) {
    return null;
  }

  const receivedAt = getMessageReceivedAt(message, now);
  const expiresAt = new Date(receivedAt.getTime() + MAX_RELEVANCE_HORIZON_MS.verification_code);
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
    title: trimText(message.from ?? null, 80) ?? defaultTitles.verification_code,
    trackingNumber: null,
  };
};

export const isGmailUsefulDetailCandidate = (
  message: AutomationMailMessage | null,
): message is AutomationMailMessage =>
  !!message?.labelIds?.includes(MAILBOX_LABELS.inbox) &&
  !message.labelIds.some((labelId) => excludedLabels.has(labelId));

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
        eq(gmailUsefulDetailEvent.gmailMessageId, gmailMessageId),
      ),
    )
    .limit(1);

  if (!event) {
    throw new Error("Could not create useful-details event.");
  }

  return event;
};

const reportUsage = async (event: {
  completionTokens: number | null;
  id: string;
  mailboxId: string;
  model: string | null;
  promptTokens: number | null;
  usageReportedAt: Date | null;
  userId: string;
}) => {
  if (
    event.usageReportedAt ||
    event.model !== GMAIL_USEFUL_DETAIL_MODEL ||
    event.promptTokens == null ||
    event.completionTokens == null
  ) {
    return;
  }

  try {
    await reportAiUsage({
      completionTokens: event.completionTokens,
      externalId: event.id,
      mailboxId: event.mailboxId,
      model: GMAIL_USEFUL_DETAIL_MODEL,
      promptTokens: event.promptTokens,
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
  usage: { completionTokens: number | null; promptTokens: number | null };
}) => {
  const now = new Date();
  const encryptedCode = detail.code ? encryptSecret(detail.code) : null;
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
        target: [gmailUsefulDetail.mailboxId, gmailUsefulDetail.kind, gmailUsefulDetail.dedupeKey],
      });
    await tx
      .update(gmailUsefulDetailEvent)
      .set({
        completionTokens: usage.completionTokens,
        lastError: null,
        model,
        nextAttemptAt: null,
        processedAt: now,
        promptTokens: usage.promptTokens,
        updatedAt: now,
        usageReportedAt: model ? null : now,
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));
  });
  return {
    ...event,
    completionTokens: usage.completionTokens,
    model,
    processedAt: now,
    promptTokens: usage.promptTokens,
    usageReportedAt: model ? event.usageReportedAt : now,
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

const getFeedbackTotals = (rows: GmailUsefulDetailFeedbackCount[], kind: GmailUsefulDetailKind) => {
  let notUseful = 0;
  let useful = 0;

  for (const row of rows) {
    if (row.kind !== kind) continue;
    if (row.signal === "useful") useful += row.count;
    else notUseful += row.count;
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
      globalTotals.notUseful >= 3 && globalTotals.notUseful / globalTotals.total >= 0.75;
    const globalPrefers =
      globalTotals.useful >= 3 && globalTotals.useful / globalTotals.total >= 0.75;

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
): Promise<GmailUsefulDetailPreferenceProfile> => {
  const rows = await db
    .select({
      count: count(),
      kind: gmailUsefulDetailFeedback.kind,
      signal: gmailUsefulDetailFeedback.signal,
      sourceCount: source
        ? sql<number>`count(*) filter (where ${gmailUsefulDetailFeedback.source} = ${source})`
        : sql<number>`0`,
    })
    .from(gmailUsefulDetailFeedback)
    .where(eq(gmailUsefulDetailFeedback.mailboxId, mailboxId))
    .groupBy(gmailUsefulDetailFeedback.kind, gmailUsefulDetailFeedback.signal);
  const global = rows.map((row) => ({ ...row, count: Number(row.count) }));
  const sourceSpecific = rows.flatMap((row) => {
    const sourceCount = Number(row.sourceCount);
    return sourceCount > 0 ? [{ ...row, count: sourceCount }] : [];
  });
  const [memoryProfile, userAiContext] = await Promise.all([
    loadAutomationMemoryPrompt({ agent: "useful_detail", mailboxId }),
    loadUserAiContextPrompt({ userId }),
  ]);

  return {
    ...buildGmailUsefulDetailPreferenceProfile({ global, source: sourceSpecific }),
    memoryProfile,
    userAiContext,
  };
};

export const processGmailUsefulDetailMessage = async ({
  gmailMessageId,
  loadMessage,
  mailboxId,
  userId,
}: {
  gmailMessageId: string;
  loadMessage: () => Promise<AutomationMailMessage | null>;
  mailboxId: string;
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
    const usageMiddleware: ChatMiddleware = {
      name: "gmail-useful-details-usage",
      onUsage: (_context, usage) => {
        promptTokens += usage.promptTokens;
        completionTokens += usage.completionTokens;
      },
    };
    const source = getSenderSource(message.from);
    const [[currentSettings], preferences] = await Promise.all([
      db
        .select({ enabled: mailboxAutomationSettings.usefulDetailsEnabled })
        .from(mailboxAutomationSettings)
        .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
        .limit(1),
      getGmailUsefulDetailPreferenceProfile(mailboxId, source, userId),
    ]);
    if (!currentSettings?.enabled) {
      await markEventProcessedWithoutUsage(event.id);
      return;
    }
    if (preferences.avoidKinds.length === USEFUL_DETAIL_KINDS.length) {
      await markEventProcessedWithoutUsage(event.id);
      return;
    }

    const verificationCode = preferences.avoidKinds.includes("verification_code")
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
        usage: { completionTokens: null, promptTokens: null },
      });
      return;
    }

    const candidate = await extractMailUsefulDetail({
      message,
      middleware: [usageMiddleware],
      preferences,
    });
    const detail = materializeGmailUsefulDetail({ candidate, message, preferences });
    const now = new Date();
    const eventUpdate = db
      .update(gmailUsefulDetailEvent)
      .set({
        completionTokens,
        lastError: null,
        model: GMAIL_USEFUL_DETAIL_MODEL,
        nextAttemptAt: null,
        processedAt: now,
        promptTokens,
        updatedAt: now,
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));

    if (!detail) {
      const [processed] = await eventUpdate.returning();
      event = processed ?? event;
    } else {
      event = await upsertGmailUsefulDetail({
        detail,
        event,
        gmailMessageId,
        message,
        model: GMAIL_USEFUL_DETAIL_MODEL,
        source,
        usage: { completionTokens, promptTokens },
      });
      const [latestSettings] = await db
        .select({ enabled: mailboxAutomationSettings.usefulDetailsEnabled })
        .from(mailboxAutomationSettings)
        .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
        .limit(1);
      if (!latestSettings?.enabled) {
        await db.delete(gmailUsefulDetail).where(eq(gmailUsefulDetail.mailboxId, mailboxId));
      }
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
          now.getTime() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attemptCount - 1)),
        ),
        updatedAt: now,
      })
      .where(eq(gmailUsefulDetailEvent.id, event.id));
    console.error(
      `Could not extract useful details from Gmail message ${gmailMessageId} for mailbox ${mailboxId}.`,
      getErrorMessage(error),
    );
  }
};

export const listPendingGmailUsefulDetailMessageIds = async (mailboxId: string) => {
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
          lte(gmailUsefulDetailEvent.nextAttemptAt, now),
        ),
      ),
    )
    .limit(20);

  return events.map((event) => event.gmailMessageId);
};

export const reportPendingGmailUsefulDetailUsage = async (mailboxId: string, userId: string) => {
  const events = await db
    .select({
      completionTokens: gmailUsefulDetailEvent.completionTokens,
      id: gmailUsefulDetailEvent.id,
      model: gmailUsefulDetailEvent.model,
      promptTokens: gmailUsefulDetailEvent.promptTokens,
      usageReportedAt: gmailUsefulDetailEvent.usageReportedAt,
    })
    .from(gmailUsefulDetailEvent)
    .where(
      and(
        eq(gmailUsefulDetailEvent.mailboxId, mailboxId),
        eq(gmailUsefulDetailEvent.model, GMAIL_USEFUL_DETAIL_MODEL),
        isNull(gmailUsefulDetailEvent.usageReportedAt),
      ),
    )
    .limit(100);

  for (const event of events) {
    await reportUsage({ ...event, mailboxId, userId });
  }
};

export const listGmailUsefulDetails = async (input: { mailboxId: string; userId: string }) => {
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
  const enabled = !!settings?.enabled && entitlement.hasAccess;
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
          eq(gmailUsefulDetailFeedback.detailId, gmailUsefulDetail.id),
        ),
      )
      .where(
        and(
          eq(gmailUsefulDetail.mailboxId, input.mailboxId),
          isNull(gmailUsefulDetail.dismissedAt),
          lte(gmailUsefulDetail.relevantFrom, now),
          gt(gmailUsefulDetail.expiresAt, now),
        ),
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
          gt(gmailUsefulDetail.expiresAt, now),
        ),
      )
      .orderBy(asc(gmailUsefulDetail.relevantFrom))
      .limit(1),
  ]);

  return {
    enabled,
    items: await serializeUsefulDetails(items),
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
  if (!settings?.enabled || !entitlement.hasAccess) return [];

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
        eq(gmailUsefulDetailFeedback.detailId, gmailUsefulDetail.id),
      ),
    )
    .where(
      and(
        eq(gmailUsefulDetail.mailboxId, input.mailboxId),
        eq(gmailUsefulDetail.gmailThreadId, input.gmailThreadId),
        isNull(gmailUsefulDetail.dismissedAt),
      ),
    )
    .orderBy(asc(gmailUsefulDetail.receivedAt));

  return await serializeUsefulDetails(items);
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
      and(eq(gmailUsefulDetail.id, input.id), eq(gmailUsefulDetail.mailboxId, input.mailboxId)),
    )
    .returning({ id: gmailUsefulDetail.id });

  if (!dismissed) {
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
      and(eq(gmailUsefulDetail.id, input.id), eq(gmailUsefulDetail.mailboxId, input.mailboxId)),
    )
    .limit(1);

  if (!detail) {
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
      target: [gmailUsefulDetailFeedback.mailboxId, gmailUsefulDetailFeedback.detailId],
    });

  if (input.feedback === "not_useful") {
    await db
      .update(gmailUsefulDetail)
      .set({ dismissedAt: now, updatedAt: now })
      .where(eq(gmailUsefulDetail.id, detail.id));
  }

  await refreshUsefulDetailMemoryProfile(input.mailboxId);
  void recordAndRefreshUserAiContext({
    kind: "useful_detail_feedback",
    mailboxId: input.mailboxId,
    metadata: {
      detailKind: detail.kind,
      signal: input.feedback,
      source: detail.source,
    },
    userId: input.userId,
  }).catch((error) => {
    console.error("Could not refresh user AI context from useful-detail feedback.", error);
  });

  return { feedback: input.feedback, id: detail.id };
};
