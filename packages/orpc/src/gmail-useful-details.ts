import { ORPCError } from "@orpc/server";
import {
  extractGmailUsefulDetail,
  GMAIL_USEFUL_DETAIL_MODEL,
  type ChatMiddleware,
  type GmailUsefulDetailCandidate,
} from "@quieter/ai";
import { reportAiUsage } from "@quieter/billing";
import { assertUserBillingFeature, hasUserBillingFeature } from "@quieter/billing/entitlements";
import {
  db,
  gmailUsefulDetail,
  gmailUsefulDetailEvent,
  gmailUsefulDetailSettings,
  mailbox,
  type GmailDeliveryStatus,
} from "@quieter/database";
import { MAILBOX_LABELS, type MessageListItem } from "@quieter/gmail";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "./gmail-mailbox-access";

const VERIFICATION_CODE_LIFETIME_MS = 1000 * 60 * 10;
const DELIVERED_LIFETIME_MS = 1000 * 60 * 60 * 48;
const PICKUP_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7;
const DELIVERY_DEFAULT_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30;
const DELIVERY_MAX_LIFETIME_MS = 1000 * 60 * 60 * 24 * 45;
const RETRY_BASE_MS = 1000 * 60 * 5;
const RETRY_MAX_MS = 1000 * 60 * 60 * 24;

const excludedLabels = new Set<string>([
  MAILBOX_LABELS.drafts,
  MAILBOX_LABELS.sent,
  MAILBOX_LABELS.spam,
  MAILBOX_LABELS.trash,
]);

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 2_000) : "Unknown useful-details error.";

const trimText = (value: string | null, maxLength: number) => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const getMessageReceivedAt = (message: MessageListItem, now: Date) => {
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

const normalizeTrackingKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const parseExpectedAt = (value: string | null) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

export type MaterializedGmailUsefulDetail =
  | {
      code: string;
      dedupeKey: string;
      expiresAt: Date;
      kind: "verification_code";
      receivedAt: Date;
      summary: null;
      title: string;
    }
  | {
      carrier: string | null;
      dedupeKey: string;
      expiresAt: Date;
      expectedAt: Date | null;
      kind: "delivery";
      receivedAt: Date;
      status: GmailDeliveryStatus;
      summary: string | null;
      title: string;
      trackingNumber: string | null;
    }
  | null;

export type GmailUsefulDetailListItem =
  | {
      code: string;
      expiresAt: Date;
      gmailMessageId: string;
      gmailThreadId: string | null;
      id: string;
      kind: "verification_code";
      receivedAt: Date;
      title: string;
    }
  | {
      carrier: string | null;
      expectedAt: Date | null;
      expiresAt: Date;
      gmailMessageId: string;
      gmailThreadId: string | null;
      id: string;
      kind: "delivery";
      receivedAt: Date;
      status: GmailDeliveryStatus;
      summary: string | null;
      title: string;
      trackingNumber: string | null;
    };

export const materializeGmailUsefulDetail = ({
  candidate,
  message,
  now = new Date(),
}: {
  candidate: GmailUsefulDetailCandidate;
  message: MessageListItem;
  now?: Date;
}): MaterializedGmailUsefulDetail => {
  const receivedAt = getMessageReceivedAt(message, now);

  if (candidate.kind === "verification_code") {
    const code = normalizeCode(candidate.code);
    const expiresAt = new Date(receivedAt.getTime() + VERIFICATION_CODE_LIFETIME_MS);
    if (!code || expiresAt <= now) {
      return null;
    }

    return {
      code,
      dedupeKey: `message:${message.id}`,
      expiresAt,
      kind: "verification_code",
      receivedAt,
      summary: null,
      title: trimText(candidate.service, 80) ?? "Verification code",
    };
  }

  if (candidate.kind !== "delivery") {
    return null;
  }

  const carrier = trimText(candidate.carrier, 80);
  const merchant = trimText(candidate.merchant, 80);
  const trackingNumber = trimText(candidate.trackingNumber, 80);
  const normalizedTrackingNumber = trackingNumber ? normalizeTrackingKey(trackingNumber) : "";
  const expectedAt = parseExpectedAt(candidate.expectedAt);
  const summary = trimText(candidate.summary, 160);
  if (
    !carrier &&
    !merchant &&
    !normalizedTrackingNumber &&
    !expectedAt &&
    !summary &&
    candidate.status == null
  ) {
    return null;
  }

  const dedupeKey = normalizedTrackingNumber
    ? `tracking:${normalizedTrackingNumber}`
    : `thread:${message.threadId ?? message.id}`;
  const status = candidate.status ?? "unknown";
  const maximumExpiry = now.getTime() + DELIVERY_MAX_LIFETIME_MS;
  const expiresAt =
    status === "delivered"
      ? new Date(now.getTime() + DELIVERED_LIFETIME_MS)
      : status === "ready_for_pickup"
        ? new Date(now.getTime() + PICKUP_LIFETIME_MS)
        : expectedAt && expectedAt.getTime() > now.getTime() - DELIVERED_LIFETIME_MS
          ? new Date(Math.min(expectedAt.getTime() + DELIVERED_LIFETIME_MS, maximumExpiry))
          : new Date(now.getTime() + DELIVERY_DEFAULT_LIFETIME_MS);

  return {
    carrier,
    dedupeKey,
    expectedAt,
    expiresAt,
    kind: "delivery",
    receivedAt,
    status,
    summary,
    title: merchant ?? carrier ?? "Delivery update",
    trackingNumber,
  };
};

export const isGmailUsefulDetailCandidate = (
  message: MessageListItem | null,
): message is MessageListItem =>
  !!message?.labelIds?.includes(MAILBOX_LABELS.inbox) &&
  !message.labelIds.some((labelId) => excludedLabels.has(labelId));

const assertOwnedGmailMailbox = async (mailboxId: string, userId: string) => {
  const [gmailMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, mailboxId),
        eq(mailbox.ownerUserId, userId),
        eq(mailbox.provider, "gmail"),
      ),
    )
    .limit(1);

  if (!gmailMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }
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
      model: GMAIL_USEFUL_DETAIL_MODEL,
      promptTokens: event.promptTokens,
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

export const processGmailUsefulDetailMessage = async ({
  gmailMessageId,
  loadMessage,
  mailboxId,
  userId,
}: {
  gmailMessageId: string;
  loadMessage: () => Promise<MessageListItem | null>;
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
    const candidate = await extractGmailUsefulDetail({
      message,
      middleware: [usageMiddleware],
    });
    const detail = materializeGmailUsefulDetail({ candidate, message });
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
    } else if (detail.kind === "verification_code") {
      const encryptedCode = encryptSecret(detail.code);
      await db.batch([
        db
          .insert(gmailUsefulDetail)
          .values({
            createdAt: now,
            dedupeKey: detail.dedupeKey,
            encryptedCode,
            expiresAt: detail.expiresAt,
            gmailMessageId,
            gmailThreadId: message.threadId ?? null,
            id: randomUUID(),
            kind: detail.kind,
            mailboxId,
            receivedAt: detail.receivedAt,
            title: detail.title,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: {
              encryptedCode,
              expiresAt: detail.expiresAt,
              gmailMessageId,
              gmailThreadId: message.threadId ?? null,
              receivedAt: detail.receivedAt,
              title: detail.title,
              updatedAt: now,
            },
            target: [
              gmailUsefulDetail.mailboxId,
              gmailUsefulDetail.kind,
              gmailUsefulDetail.dedupeKey,
            ],
          }),
        eventUpdate,
      ]);
      event = {
        ...event,
        completionTokens,
        model: GMAIL_USEFUL_DETAIL_MODEL,
        processedAt: now,
        promptTokens,
      };
    } else {
      await db.batch([
        db
          .insert(gmailUsefulDetail)
          .values({
            carrier: detail.carrier,
            createdAt: now,
            dedupeKey: detail.dedupeKey,
            deliveryStatus: detail.status,
            expectedAt: detail.expectedAt,
            expiresAt: detail.expiresAt,
            gmailMessageId,
            gmailThreadId: message.threadId ?? null,
            id: randomUUID(),
            kind: detail.kind,
            mailboxId,
            receivedAt: detail.receivedAt,
            summary: detail.summary,
            title: detail.title,
            trackingNumber: detail.trackingNumber,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: {
              carrier: detail.carrier,
              deliveryStatus: detail.status,
              expectedAt: detail.expectedAt,
              expiresAt: detail.expiresAt,
              gmailMessageId,
              gmailThreadId: message.threadId ?? null,
              receivedAt: detail.receivedAt,
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
          }),
        eventUpdate,
      ]);
      event = {
        ...event,
        completionTokens,
        model: GMAIL_USEFUL_DETAIL_MODEL,
        processedAt: now,
        promptTokens,
      };
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
    await reportUsage({ ...event, userId });
  }
};

export const cleanupExpiredGmailUsefulDetails = async (mailboxId: string) => {
  await db
    .delete(gmailUsefulDetail)
    .where(
      and(eq(gmailUsefulDetail.mailboxId, mailboxId), lte(gmailUsefulDetail.expiresAt, new Date())),
    );
};

export const setGmailUsefulDetails = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input.mailboxId, input.userId);

  if (input.enabled) {
    await assertUserBillingFeature({
      feature: "gmailAutomation",
      userId: input.userId,
    });
  }

  const now = new Date();
  await db
    .insert(gmailUsefulDetailSettings)
    .values({
      createdAt: now,
      enabled: input.enabled,
      mailboxId: input.mailboxId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        enabled: input.enabled,
        updatedAt: now,
      },
      target: gmailUsefulDetailSettings.mailboxId,
    });

  if (!input.enabled) {
    await db.delete(gmailUsefulDetail).where(eq(gmailUsefulDetail.mailboxId, input.mailboxId));
  }

  return {
    enabled: input.enabled,
    mailboxId: input.mailboxId,
  };
};

export const listGmailUsefulDetails = async (input: { mailboxId: string; userId: string }) => {
  await assertOwnedGmailMailbox(input.mailboxId, input.userId);
  const [[settings], entitlement] = await Promise.all([
    db
      .select({ enabled: gmailUsefulDetailSettings.enabled })
      .from(gmailUsefulDetailSettings)
      .where(eq(gmailUsefulDetailSettings.mailboxId, input.mailboxId))
      .limit(1),
    hasUserBillingFeature({ feature: "gmailAutomation", userId: input.userId }),
  ]);
  const enabled = !!settings?.enabled && entitlement.hasAccess;
  if (!enabled) {
    return { enabled, items: [] as GmailUsefulDetailListItem[] };
  }

  await cleanupExpiredGmailUsefulDetails(input.mailboxId);
  const items = await db
    .select()
    .from(gmailUsefulDetail)
    .where(
      and(
        eq(gmailUsefulDetail.mailboxId, input.mailboxId),
        isNull(gmailUsefulDetail.dismissedAt),
        gt(gmailUsefulDetail.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(gmailUsefulDetail.expiresAt))
    .limit(6);

  const visibleItems: GmailUsefulDetailListItem[] = [];

  for (const item of items) {
    if (item.kind === "verification_code") {
      if (!item.encryptedCode) continue;
      try {
        visibleItems.push({
          code: decryptSecret(item.encryptedCode),
          expiresAt: item.expiresAt,
          gmailMessageId: item.gmailMessageId,
          gmailThreadId: item.gmailThreadId,
          id: item.id,
          kind: item.kind,
          receivedAt: item.receivedAt,
          title: item.title,
        });
      } catch (error) {
        console.error(`Could not decrypt useful detail ${item.id}.`, getErrorMessage(error));
      }
      continue;
    }

    visibleItems.push({
      carrier: item.carrier,
      expectedAt: item.expectedAt,
      expiresAt: item.expiresAt,
      gmailMessageId: item.gmailMessageId,
      gmailThreadId: item.gmailThreadId,
      id: item.id,
      kind: item.kind,
      receivedAt: item.receivedAt,
      status: item.deliveryStatus ?? "unknown",
      summary: item.summary,
      title: item.title,
      trackingNumber: item.trackingNumber,
    });
  }

  return { enabled, items: visibleItems };
};

export const dismissGmailUsefulDetail = async (input: {
  id: string;
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input.mailboxId, input.userId);
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
