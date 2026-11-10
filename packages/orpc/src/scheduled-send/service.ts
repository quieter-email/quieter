import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailComposeOperation,
  managedMailMessage,
  organizationMailSendIdempotency,
  scheduledMailSend,
  scheduledMailSendAbandonment,
} from "@quieter/database/schema";
import type {
  createScheduledSendSchema,
  rescheduleSendSchema,
} from "@quieter/mail/scheduled-send";
import type { ScheduledSendScope } from "@quieter/mail/scheduled-send-ticket";
import { reportError } from "@quieter/observability";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { publishMailUpdate } from "../mail-updates";
import { composeMailOperations } from "../mail/compose";
import { withMailComposeLock } from "../mail/compose-lock";
import { queriesMailOperations } from "../mail/queries";
import { assertAccessibleMailbox } from "../mailbox/service";
import { readRawMailObject } from "../managed-mail/messages/raw-object";
import { storeRawMailObject } from "../managed-mail/messages/raw-object-lifecycle";
import { hashRequest } from "../request-hash";
import {
  assertScheduledSendAttemptActive,
  withScheduledSendAttemptLock,
} from "./attempts";
import {
  captureScheduledSendPayload,
  restoreScheduledSendPayload,
  scheduledSendPayloadSchema,
} from "./payload";
import { resolveComposeSourceDraftId } from "./reservation";
import { requestScheduledSendWake } from "./wake";

type ScheduledSend = typeof scheduledMailSend.$inferSelect;
const LEASE_MS = 2 * 60_000;
const RECONCILE_MS = 5 * 60_000;

export const validateScheduledSendTime = (
  sendAt: string,
  followUpAt?: string,
  now = new Date()
) => {
  const due = new Date(sendAt);
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + 5);
  if (
    !Number.isFinite(due.getTime()) ||
    due.getTime() < now.getTime() + 60_000 ||
    due > latest
  ) {
    throw new ORPCError("BAD_REQUEST", {
      data: { scheduledTimeInvalid: true },
      message:
        "Choose a time at least a minute from now and within five years.",
    });
  }
  if (followUpAt !== undefined && new Date(followUpAt) <= due) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Choose a follow-up reminder after the scheduled send time, or remove it.",
    });
  }
  return due;
};

const toSummary = (row: ScheduledSend) => ({
  errorMessage: row.errorMessage,
  id: row.id,
  mailboxId: row.mailboxId,
  sendAt: row.sendAt.toISOString(),
  sendOperationId: row.sendOperationId,
  status: row.status,
  subject: row.subject,
  timeZone: row.timeZone,
  to: row.to,
});

const assertCanSchedule = async (scope: {
  userId: string;
  mailboxId: string;
}) => {
  const selected = await assertAccessibleMailbox(scope);
  if (!selected.capabilities.canSend) {
    throw new ORPCError("FORBIDDEN", {
      message: "You do not have permission to send from this mailbox.",
    });
  }
  return selected;
};

const getScopedSend = async (scope: ScheduledSendScope) => {
  const [row] = await db
    .select()
    .from(scheduledMailSend)
    .where(
      and(
        eq(scheduledMailSend.id, scope.id),
        eq(scheduledMailSend.mailboxId, scope.mailboxId),
        eq(scheduledMailSend.userId, scope.userId)
      )
    )
    .limit(1);
  return row ?? null;
};

const readPayload = async (row: ScheduledSend) => {
  if (row.payloadRetiredAt !== null) {
    throw new ORPCError("CONFLICT", {
      message: "This scheduled message is already complete.",
    });
  }
  const raw = await readRawMailObject({ ...row, s3Bucket: null, s3Key: null });
  const value: unknown = JSON.parse(new TextDecoder().decode(raw));
  return scheduledSendPayloadSchema.parse(value);
};

const notifyMailbox = async (mailboxId: string) => {
  await publishMailUpdate({ mailboxId, type: "mailbox.changed" });
};

const claimSend = async (row: ScheduledSend) => {
  const token = crypto.randomUUID();
  const now = new Date();
  const [claimed] = await db
    .update(scheduledMailSend)
    .set({
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      nextWakeAt: new Date(now.getTime() + LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(scheduledMailSend.id, row.id),
        eq(scheduledMailSend.status, row.status),
        eq(scheduledMailSend.sendAt, row.sendAt),
        or(
          isNull(scheduledMailSend.leaseUntil),
          lte(scheduledMailSend.leaseUntil, now)
        )
      )
    )
    .returning();
  return claimed === undefined ? null : { row: claimed, token };
};

const finishPreparation = async (row: ScheduledSend) => {
  const claimed = await claimSend(row);
  if (claimed === null) {
    return await getScopedSend(row);
  }
  try {
    await assertCanSchedule(row);
    const payload = await readPayload(row);
    if (payload.draftId) {
      await composeMailOperations.deleteDraft({
        context: { userId: row.userId },
        input: {
          baseRevision: payload.baseRevision,
          draftId: payload.draftId,
          mailboxId: row.mailboxId,
        },
        requireExistingDraft: true,
      });
    }
    const [prepared] = await db
      .update(scheduledMailSend)
      .set({
        draftRemovedAt: new Date(),
        errorMessage: null,
        leaseToken: null,
        leaseUntil: null,
        nextWakeAt: new Date(
          Math.min(row.sendAt.getTime(), Date.now() + 60_000)
        ),
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, claimed.token)
        )
      )
      .returning();
    await notifyMailbox(row.mailboxId);
    return prepared ?? (await getScopedSend(row));
  } catch (error) {
    const expected =
      error instanceof ORPCError && error.status >= 400 && error.status < 500;
    await db
      .update(scheduledMailSend)
      .set({
        errorMessage: expected
          ? error.message
          : "Scheduling could not finish. Your message is saved.",
        leaseToken: null,
        leaseUntil: null,
        nextWakeAt: expected ? null : new Date(Date.now() + 60_000),
        status: expected ? "failed" : "preparing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, claimed.token)
        )
      );
    if (!expected) {
      reportError(error, { operation: "scheduled-send-prepare" });
    }
    return await getScopedSend(row);
  }
};

const createScheduledSendWithinLock = async (
  input: z.infer<typeof createScheduledSendSchema> & { userId: string }
) => {
  const selectedMailbox = await assertCanSchedule(input);
  const sendOperationId =
    input.message.sendOperationId ?? input.message.localId;
  const [existing] = await db
    .select()
    .from(scheduledMailSend)
    .where(
      and(
        eq(scheduledMailSend.mailboxId, input.mailboxId),
        eq(scheduledMailSend.userId, input.userId),
        eq(scheduledMailSend.sendOperationId, sendOperationId)
      )
    )
    .limit(1);
  const attempt = {
    mailboxId: input.mailboxId,
    sendOperationId,
    userId: input.userId,
  };
  if (existing === undefined) {
    await assertScheduledSendAttemptActive(attempt);
  }
  const payload = await captureScheduledSendPayload(input.message);
  const requestHash = hashRequest({
    attachments: payload.attachments.map(
      ({ content, contentId, isInline, mimeType, name }) => ({
        content,
        contentId,
        isInline,
        mimeType,
        name,
      })
    ),
    bodyHtml: payload.bodyHtml,
    bodyText: payload.bodyText,
    draftAnchor: payload.draftAnchor,
    followUpReminder: payload.followUpReminder,
    headers: payload.headers,
    inlineImages: payload.inlineImages.map(
      ({ content, contentId, isInline, mimeType, name }) => ({
        content,
        contentId,
        isInline,
        mimeType,
        name,
      })
    ),
    recipients: payload.recipients,
    replyContext: payload.replyContext,
    senderName: payload.senderName,
    subject: payload.subject,
  });
  if (existing !== undefined) {
    if (existing.requestHash !== requestHash) {
      throw new ORPCError("CONFLICT", {
        message:
          "This message already has a schedule. Open Scheduled to change it.",
      });
    }
    const current =
      existing.status === "preparing"
        ? await finishPreparation(existing)
        : existing;
    if (current === null) {
      throw new ORPCError("NOT_FOUND", {
        message: "Scheduled message not found.",
      });
    }
    await requestScheduledSendWake(current);
    return toSummary(current);
  }
  const delivery = await composeMailOperations.getComposeSendStatus({
    context: { userId: input.userId },
    input: { mailboxId: input.mailboxId, sendOperationId },
  });
  if (delivery.status !== "rejected") {
    throw new ORPCError("CONFLICT", {
      message:
        "This message already has a send attempt. Check Sent before scheduling it.",
    });
  }
  const sendAt = validateScheduledSendTime(
    input.sendAt,
    payload.followUpReminder?.dueAt
  );
  if (input.message.draftId) {
    const source = await queriesMailOperations.getDraft({
      context: { userId: input.userId },
      input: { draftId: input.message.draftId, mailboxId: input.mailboxId },
    });
    const priorSend =
      selectedMailbox.provider === "managed"
        ? await db
            .select({ id: organizationMailSendIdempotency.id })
            .from(organizationMailSendIdempotency)
            .where(
              and(
                eq(
                  organizationMailSendIdempotency.organizationId,
                  selectedMailbox.organizationId ?? ""
                ),
                sql`${organizationMailSendIdempotency.snapshot}->>'mailboxId' = ${input.mailboxId}`,
                sql`${organizationMailSendIdempotency.snapshot}->>'draftId' = ${source.messageId ?? ""}`,
                sql`${organizationMailSendIdempotency.snapshot}->>'draftUpdatedAt' = ${source.baseRevision ?? ""}`,
                inArray(organizationMailSendIdempotency.status, [
                  "submitting",
                  "unknown",
                  "accepted",
                  "completed",
                ])
              )
            )
            .limit(1)
        : await db
            .select({ id: gmailComposeOperation.id })
            .from(gmailComposeOperation)
            .where(
              and(
                eq(gmailComposeOperation.mailboxId, input.mailboxId),
                eq(gmailComposeOperation.draftId, input.message.draftId),
                eq(gmailComposeOperation.kind, "send"),
                inArray(gmailComposeOperation.status, [
                  "submitting",
                  "unknown",
                  "accepted",
                ])
              )
            )
            .limit(1);
    if (priorSend.length > 0) {
      throw new ORPCError("CONFLICT", {
        message:
          "This draft already has a send attempt. Check Sent before scheduling it.",
      });
    }
  }
  if (selectedMailbox.provider === "managed" && !input.message.draftId) {
    const [savedAlias] = await db
      .select({ id: managedMailMessage.id })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(
            managedMailMessage.providerMessageId,
            `draft:${input.message.localId}`
          ),
          eq(managedMailMessage.mailboxState, "draft")
        )
      )
      .limit(1);
    if (savedAlias !== undefined) {
      throw new ORPCError("CONFLICT", {
        message: "This draft changed elsewhere. Reopen it before scheduling.",
      });
    }
  }
  const id = crypto.randomUUID();
  const rawObject = await storeRawMailObject(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const sourceDraftId = await resolveComposeSourceDraftId({
    ...input.message,
    mailboxId: input.mailboxId,
    provider: selectedMailbox.provider,
  });
  const inserted = await withScheduledSendAttemptLock(
    attempt,
    async (database) => {
      await assertScheduledSendAttemptActive(attempt, database);
      const [created] = await database
        .insert(scheduledMailSend)
        .values({
          createdAt: new Date(),
          id,
          mailboxId: input.mailboxId,
          nextWakeAt: new Date(Date.now() + 60_000),
          rawObjectBucket: rawObject.bucket,
          rawObjectKey: rawObject.key,
          rawObjectProvider: rawObject.provider,
          requestHash,
          sendAt,
          sendOperationId,
          sourceDraftId,
          sourceLocalId: input.message.localId,
          status: "preparing",
          subject: payload.subject,
          timeZone: input.timeZone,
          to: payload.recipients.to,
          updatedAt: new Date(),
          userId: input.userId,
        })
        .onConflictDoNothing()
        .returning();
      return created;
    }
  );
  if (inserted === undefined) {
    const [concurrent] = await db
      .select()
      .from(scheduledMailSend)
      .where(
        and(
          eq(scheduledMailSend.mailboxId, input.mailboxId),
          eq(scheduledMailSend.userId, input.userId),
          eq(scheduledMailSend.sendOperationId, sendOperationId)
        )
      )
      .limit(1);
    if (concurrent === undefined) {
      throw new ORPCError("CONFLICT", {
        message:
          "This draft already has a scheduled send. Open Scheduled to change it.",
      });
    }
    return toSummary(concurrent);
  }
  const current = await finishPreparation(inserted);
  if (current === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "Scheduled message not found.",
    });
  }
  await requestScheduledSendWake(current);
  return toSummary(current);
};

export const createScheduledSend = async (
  input: z.infer<typeof createScheduledSendSchema> & { userId: string }
) => {
  const selectedMailbox = await assertCanSchedule(input);
  const sourceDraftId = await resolveComposeSourceDraftId({
    ...input.message,
    mailboxId: input.mailboxId,
    provider: selectedMailbox.provider,
  });
  if (
    selectedMailbox.provider === "gmail" &&
    sourceDraftId !== null &&
    !input.message.draftId
  ) {
    throw new ORPCError("CONFLICT", {
      message: "This draft changed elsewhere. Reopen it before scheduling.",
    });
  }
  try {
    return await withMailComposeLock(
      input.mailboxId,
      `source:${sourceDraftId ?? input.message.localId}`,
      async () => await createScheduledSendWithinLock(input)
    );
  } catch (error) {
    if (
      error instanceof ORPCError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      throw error;
    }
    reportError(error, { operation: "scheduled-send-create" });
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      data: { deliveryUncertain: true },
      message:
        "The scheduling result could not be confirmed. Check Scheduled before sending again.",
    });
  }
};

export const listScheduledSends = async (scope: {
  mailboxId: string;
  userId: string;
}) => {
  await assertAccessibleMailbox(scope);
  const rows = await db
    .select()
    .from(scheduledMailSend)
    .where(
      and(
        eq(scheduledMailSend.mailboxId, scope.mailboxId),
        eq(scheduledMailSend.userId, scope.userId),
        inArray(scheduledMailSend.status, [
          "preparing",
          "scheduled",
          "sending",
          "failed",
          "uncertain",
          "cancelled",
        ]),
        isNull(scheduledMailSend.payloadRetiredAt)
      )
    )
    .orderBy(asc(scheduledMailSend.sendAt), asc(scheduledMailSend.id));
  return rows.map(toSummary);
};

export const getScheduledSendByOperation = async (scope: {
  mailboxId: string;
  userId: string;
  sendOperationId: string;
}) => {
  await assertAccessibleMailbox(scope);
  const [row] = await db
    .select()
    .from(scheduledMailSend)
    .where(
      and(
        eq(scheduledMailSend.mailboxId, scope.mailboxId),
        eq(scheduledMailSend.userId, scope.userId),
        eq(scheduledMailSend.sendOperationId, scope.sendOperationId)
      )
    )
    .limit(1);
  return row === undefined ? null : toSummary(row);
};

export const recoverScheduledSendAttempt = async (scope: {
  mailboxId: string;
  userId: string;
  sendOperationId: string;
}) => {
  await assertAccessibleMailbox(scope);
  return await withScheduledSendAttemptLock(scope, async (database) => {
    const [scheduled] = await database
      .select()
      .from(scheduledMailSend)
      .where(
        and(
          eq(scheduledMailSend.mailboxId, scope.mailboxId),
          eq(scheduledMailSend.userId, scope.userId),
          eq(scheduledMailSend.sendOperationId, scope.sendOperationId)
        )
      )
      .limit(1);
    if (scheduled !== undefined) {
      return { scheduled: toSummary(scheduled), status: "scheduled" as const };
    }
    await database
      .insert(scheduledMailSendAbandonment)
      .values({ ...scope, createdAt: new Date() })
      .onConflictDoNothing();
    return { status: "abandoned" as const };
  });
};

export const rescheduleSend = async (
  input: z.infer<typeof rescheduleSendSchema> & { userId: string }
) => {
  await assertCanSchedule(input);
  const row = await getScopedSend(input);
  if (row === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "Scheduled message not found.",
    });
  }
  const payload = await readPayload(row);
  const sendAt = validateScheduledSendTime(
    input.sendAt,
    payload.followUpReminder?.dueAt
  );
  const [updated] = await db
    .update(scheduledMailSend)
    .set({
      errorMessage: null,
      nextWakeAt: new Date(Math.min(sendAt.getTime(), Date.now() + 60_000)),
      sendAt,
      status: row.draftRemovedAt === null ? "preparing" : "scheduled",
      timeZone: input.timeZone,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledMailSend.id, row.id),
        inArray(scheduledMailSend.status, ["scheduled", "failed"]),
        or(
          isNull(scheduledMailSend.leaseUntil),
          lte(scheduledMailSend.leaseUntil, new Date())
        )
      )
    )
    .returning();
  if (updated === undefined) {
    throw new ORPCError("CONFLICT", {
      message:
        "This message has started sending and can no longer be rescheduled.",
    });
  }
  await requestScheduledSendWake(updated);
  return toSummary(updated);
};

const restoreCancelledSend = async (row: ScheduledSend) => {
  if (row.payloadRetiredAt !== null) {
    return row;
  }
  const claimed = await claimSend(row);
  if (claimed === null) {
    throw new ORPCError("CONFLICT", {
      message: "This message is returning to Drafts. Try again shortly.",
    });
  }
  try {
    const payload = await readPayload(row);
    const draft = restoreScheduledSendPayload(payload, {
      localId: `${row.id}:restore`,
      sendOperationId: row.id,
    });
    const restored = await composeMailOperations.saveDraft({
      context: { userId: row.userId },
      input: { draft, mailboxId: row.mailboxId },
    });
    const [completed] = await db
      .update(scheduledMailSend)
      .set({
        errorMessage: null,
        leaseToken: null,
        leaseUntil: null,
        nextWakeAt: null,
        payloadRetiredAt: new Date(),
        restoredDraftId: restored.draftId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, claimed.token)
        )
      )
      .returning();
    await notifyMailbox(row.mailboxId);
    return completed ?? (await getScopedSend(row));
  } catch (error) {
    await db
      .update(scheduledMailSend)
      .set({
        errorMessage:
          "Sending is cancelled. Your message is saved here until it can return to Drafts.",
        leaseToken: null,
        leaseUntil: null,
        nextWakeAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, claimed.token)
        )
      );
    throw error;
  }
};

export const cancelScheduledSend = async (scope: ScheduledSendScope) => {
  await assertCanSchedule(scope);
  const row = await getScopedSend(scope);
  if (row === null) {
    throw new ORPCError("NOT_FOUND", {
      message: "Scheduled message not found.",
    });
  }
  if (row.status === "cancelled") {
    const restored = await restoreCancelledSend(row);
    return {
      ...toSummary(restored ?? row),
      draftId: restored?.restoredDraftId ?? row.restoredDraftId,
    };
  }
  const [cancelled] = await db
    .update(scheduledMailSend)
    .set({
      errorMessage: null,
      nextWakeAt: new Date(Date.now() + 60_000),
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledMailSend.id, row.id),
        inArray(scheduledMailSend.status, ["preparing", "scheduled", "failed"]),
        or(
          isNull(scheduledMailSend.leaseUntil),
          lte(scheduledMailSend.leaseUntil, new Date())
        )
      )
    )
    .returning();
  if (cancelled === undefined) {
    throw new ORPCError("CONFLICT", {
      message:
        "This message has started sending and can no longer be cancelled. Check Sent for its delivery status.",
    });
  }
  const restored = await restoreCancelledSend(cancelled);
  return {
    ...toSummary(restored ?? cancelled),
    draftId: restored?.restoredDraftId ?? null,
  };
};

export const dispatchScheduledSend = async (
  scope: ScheduledSendScope
): Promise<{ nextWakeAt: number | null }> => {
  let row = await getScopedSend(scope);
  if (row === null || row.status === "sent" || row.payloadRetiredAt !== null) {
    return { nextWakeAt: null };
  }
  if (row.leaseUntil !== null && row.leaseUntil.getTime() > Date.now()) {
    return { nextWakeAt: row.leaseUntil.getTime() };
  }
  if (row.status === "preparing") {
    row = await finishPreparation(row);
    if (row === null) {
      return { nextWakeAt: null };
    }
    if (row.status === "preparing") {
      return { nextWakeAt: row.nextWakeAt?.getTime() ?? Date.now() + 60_000 };
    }
  }
  if (row.status === "cancelled") {
    await restoreCancelledSend(row);
    return { nextWakeAt: null };
  }
  if (row.status === "failed") {
    return { nextWakeAt: null };
  }
  if (row.status === "scheduled" && row.sendAt.getTime() > Date.now()) {
    await db
      .update(scheduledMailSend)
      .set({ nextWakeAt: row.sendAt })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.status, "scheduled"),
          eq(scheduledMailSend.sendAt, row.sendAt)
        )
      );
    return { nextWakeAt: row.sendAt.getTime() };
  }
  const claimed = await claimSend(row);
  if (claimed === null) {
    const current = await getScopedSend(scope);
    return { nextWakeAt: current?.nextWakeAt?.getTime() ?? null };
  }
  const wasSubmitted = row.status === "sending" || row.status === "uncertain";
  const { token } = claimed;
  let submissionStarted = wasSubmitted;
  try {
    await assertCanSchedule(scope);
    if (wasSubmitted) {
      const receipt = await composeMailOperations.getComposeSendStatus({
        context: { userId: row.userId },
        input: {
          mailboxId: row.mailboxId,
          sendOperationId: row.sendOperationId,
        },
      });
      if (receipt.status === "sent") {
        await db
          .update(scheduledMailSend)
          .set({
            errorMessage: null,
            leaseToken: null,
            leaseUntil: null,
            nextWakeAt: null,
            payloadRetiredAt: new Date(),
            sentAt: new Date(),
            status: "sent",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scheduledMailSend.id, row.id),
              eq(scheduledMailSend.leaseToken, token)
            )
          );
        await notifyMailbox(row.mailboxId);
        return { nextWakeAt: null };
      }
      if (
        receipt.status === "rejected" &&
        receipt.definitiveRejection === true
      ) {
        await db
          .update(scheduledMailSend)
          .set({
            errorMessage:
              "Sending did not complete. Choose a new time or return this message to Drafts.",
            leaseToken: null,
            leaseUntil: null,
            nextWakeAt: null,
            status: "failed",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scheduledMailSend.id, row.id),
              eq(scheduledMailSend.leaseToken, token)
            )
          );
        await notifyMailbox(row.mailboxId);
        return { nextWakeAt: null };
      }
      if (receipt.status === "pending" || row.status === "uncertain") {
        const nextWakeAt = Date.now() + RECONCILE_MS;
        await db
          .update(scheduledMailSend)
          .set({
            errorMessage:
              "Delivery is being confirmed. Check Sent before sending again.",
            leaseToken: null,
            leaseUntil: null,
            nextWakeAt: new Date(nextWakeAt),
            status: "uncertain",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scheduledMailSend.id, row.id),
              eq(scheduledMailSend.leaseToken, token)
            )
          );
        return { nextWakeAt };
      }
    }
    const payload = await readPayload(row);
    const message = restoreScheduledSendPayload(payload, {
      localId: `scheduled:${row.id}`,
      sendOperationId: row.sendOperationId,
    });
    const [sending] = await db
      .update(scheduledMailSend)
      .set({
        status: "sending",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, token)
        )
      )
      .returning();
    if (sending === undefined) {
      return { nextWakeAt: Date.now() + LEASE_MS };
    }
    submissionStarted = true;
    await composeMailOperations.sendMessage({
      context: { userId: row.userId },
      input: { mailboxId: row.mailboxId, message },
      scheduledSendId: row.id,
    });
    await db
      .update(scheduledMailSend)
      .set({
        errorMessage: null,
        leaseToken: null,
        leaseUntil: null,
        nextWakeAt: null,
        payloadRetiredAt: new Date(),
        sentAt: new Date(),
        status: "sent",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, token)
        )
      );
    await notifyMailbox(row.mailboxId);
    return { nextWakeAt: null };
  } catch (error) {
    const errorData: unknown =
      error instanceof ORPCError ? error.data : undefined;
    const expected =
      error instanceof ORPCError && error.status >= 400 && error.status < 500;
    const rejected =
      typeof errorData === "object" &&
      errorData !== null &&
      "sendRejected" in errorData &&
      errorData.sendRejected === true;
    const deliveryUncertain =
      typeof errorData === "object" &&
      errorData !== null &&
      "deliveryUncertain" in errorData &&
      errorData.deliveryUncertain === true;
    const sendNotStarted =
      typeof errorData === "object" &&
      errorData !== null &&
      "sendNotStarted" in errorData &&
      errorData.sendNotStarted === true;
    const uncertain =
      wasSubmitted ||
      (submissionStarted &&
        !sendNotStarted &&
        !rejected &&
        (!expected || deliveryUncertain));
    const retry =
      !wasSubmitted && (!submissionStarted || sendNotStarted) && !expected;
    let nextWakeAt: number | null = null;
    let status: ScheduledSend["status"] = "failed";
    let errorMessage =
      error instanceof Error ? error.message : "Sending failed.";
    if (uncertain) {
      nextWakeAt = Date.now() + RECONCILE_MS;
      status = "uncertain";
      errorMessage =
        "Delivery is being confirmed. Check Sent before sending again.";
    } else if (retry) {
      nextWakeAt = Date.now() + 60_000;
      status = "scheduled";
      errorMessage =
        "Sending could not start. Your message is saved and will retry shortly.";
    }
    await db
      .update(scheduledMailSend)
      .set({
        errorMessage,
        leaseToken: null,
        leaseUntil: null,
        nextWakeAt: nextWakeAt === null ? null : new Date(nextWakeAt),
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMailSend.id, row.id),
          eq(scheduledMailSend.leaseToken, token)
        )
      );
    if (!expected) {
      reportError(error, { operation: "scheduled-send-dispatch" });
    }
    await notifyMailbox(row.mailboxId);
    return { nextWakeAt };
  }
};
