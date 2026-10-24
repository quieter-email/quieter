import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  gmailCaptureState,
  managedMailMessage,
  mailbox,
  mailMessageImportance,
} from "@quieter/database/schema";
import {
  getGmailCapturedSnapshot,
  getGmailCaptureMetadata,
  getGmailProfile,
  isGmailServiceError,
  listGmailCaptureHistoryPage,
  listGmailMessageIds,
} from "@quieter/gmail";
import {
  analyzeMailMessage,
  boundMailCaptureContent,
  truncateMailCaptureText,
} from "@quieter/mail/capture";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { ensureMailImportanceWork } from "./mail-importance";
import { assertAccessibleMailbox } from "./mailbox/service";

type CaptureTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const LEASE_MS = 5 * 60 * 1000;

const lockCaptureLease = async (
  tx: CaptureTransaction,
  mailboxId: string,
  leaseId: string
) => {
  const [state] = await tx
    .select()
    .from(gmailCaptureState)
    .where(
      and(
        eq(gmailCaptureState.mailboxId, mailboxId),
        eq(gmailCaptureState.leaseId, leaseId),
        gt(gmailCaptureState.leaseExpiresAt, new Date())
      )
    )
    .for("update");
  if (state === undefined) {
    throw new Error("Mail capture lease expired.");
  }
};

export const writeGmailCapturedMessage = async (input: {
  mailboxId: string;
  snapshot: CapturedMailSnapshot;
  source: typeof gmailCapturedMessage.$inferInsert.source;
  leaseId?: string;
}) => {
  if (input.snapshot.labelIds.includes(MAILBOX_LABELS.drafts)) {
    return;
  }
  const bounded = boundMailCaptureContent(input.snapshot);
  const snapshot: CapturedMailSnapshot = {
    ...input.snapshot,
    ...bounded,
    attachments: input.snapshot.attachments.slice(0, 128).map((attachment) => ({
      ...attachment,
      fileName: truncateMailCaptureText(attachment.fileName, 512),
      mimeType: truncateMailCaptureText(attachment.mimeType, 256),
    })),
    labelIds: input.snapshot.labelIds
      .slice(0, 512)
      .map((label) => truncateMailCaptureText(label, 256)),
    truncation: {
      attachments:
        input.snapshot.truncation.attachments ||
        input.snapshot.attachments.length > 128,
      bodyHtml:
        bounded.truncation.bodyHtml || input.snapshot.truncation.bodyHtml,
      bodyText:
        bounded.truncation.bodyText || input.snapshot.truncation.bodyText,
      headers: bounded.truncation.headers || input.snapshot.truncation.headers,
    },
  };
  const analysis = analyzeMailMessage(snapshot);
  analysis.truncated ||= Object.values(snapshot.truncation).some(Boolean);
  const now = new Date();
  await db.transaction(async (tx) => {
    if (input.leaseId) {
      await lockCaptureLease(tx, input.mailboxId, input.leaseId);
    }
    const accepted = await tx
      .insert(gmailCapturedMessage)
      .values({
        analysis,
        capturedAt: now,
        deletedAt: null,
        mailboxId: input.mailboxId,
        messageId: snapshot.id,
        providerRevision: snapshot.providerRevision,
        snapshot,
        source: input.source,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          analysis,
          deletedAt: null,
          providerRevision: snapshot.providerRevision,
          snapshot,
          source: input.source,
          updatedAt: now,
        },
        setWhere: sql`${gmailCapturedMessage.providerRevision}::numeric < ${snapshot.providerRevision}::numeric or (${gmailCapturedMessage.providerRevision}::numeric = ${snapshot.providerRevision}::numeric and ${gmailCapturedMessage.deletedAt} is null and ${gmailCapturedMessage.snapshot} is distinct from excluded.snapshot)`,
        target: [
          gmailCapturedMessage.mailboxId,
          gmailCapturedMessage.messageId,
        ],
      })
      .returning({ messageId: gmailCapturedMessage.messageId });
    if (accepted.length && !snapshot.labelIds.includes("SENT")) {
      await ensureMailImportanceWork(tx, {
        mailboxId: input.mailboxId,
        message: snapshot,
        messageId: snapshot.id,
        receivedAt: new Date(Number(snapshot.internalDate) || now.getTime()),
        threadId: snapshot.threadId,
      });
    }
    if (accepted.length) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: now,
        })
        .where(eq(mailbox.id, input.mailboxId));
    }
  });
};

export const deleteGmailCapturedMessage = async (input: {
  mailboxId: string;
  messageId: string;
  providerRevision: string;
  leaseId?: string;
}) => {
  const now = new Date();
  await db.transaction(async (tx) => {
    if (input.leaseId) {
      await lockCaptureLease(tx, input.mailboxId, input.leaseId);
    }
    const accepted = await tx
      .insert(gmailCapturedMessage)
      .values({
        analysis: null,
        capturedAt: now,
        deletedAt: now,
        mailboxId: input.mailboxId,
        messageId: input.messageId,
        providerRevision: input.providerRevision,
        snapshot: null,
        source: "history",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          analysis: null,
          deletedAt: now,
          providerRevision: input.providerRevision,
          snapshot: null,
          updatedAt: now,
        },
        setWhere: sql`${gmailCapturedMessage.providerRevision}::numeric <= ${input.providerRevision}::numeric`,
        target: [
          gmailCapturedMessage.mailboxId,
          gmailCapturedMessage.messageId,
        ],
      })
      .returning({ messageId: gmailCapturedMessage.messageId });
    if (accepted.length) {
      await tx
        .update(mailMessageImportance)
        .set({
          leaseExpiresAt: null,
          leaseId: null,
          state: "cancelled",
          updatedAt: now,
        })
        .where(
          and(
            eq(mailMessageImportance.mailboxId, input.mailboxId),
            eq(mailMessageImportance.messageId, input.messageId)
          )
        );
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: now,
        })
        .where(eq(mailbox.id, input.mailboxId));
    }
  });
};

const checkpointCapture = async (
  mailboxId: string,
  leaseId: string,
  changes: Partial<typeof gmailCaptureState.$inferInsert>
) => {
  await db.transaction(async (tx) => {
    await lockCaptureLease(tx, mailboxId, leaseId);
    const now = new Date();
    await tx
      .update(gmailCaptureState)
      .set({
        ...changes,
        lastErrorAt: null,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(gmailCaptureState.mailboxId, mailboxId),
          eq(gmailCaptureState.leaseId, leaseId)
        )
      );
  });
};

const captureMessage = async (input: {
  accessToken: string;
  mailboxId: string;
  messageId: string;
  providerRevision: string;
  source: typeof gmailCapturedMessage.$inferInsert.source;
  leaseId: string;
}) => {
  try {
    const snapshot = await getGmailCapturedSnapshot(
      input.accessToken,
      input.messageId
    );
    await writeGmailCapturedMessage({ ...input, snapshot });
  } catch (error) {
    if (!isGmailServiceError(error) || error.status !== 404) {
      throw error;
    }
    await deleteGmailCapturedMessage(input);
  }
};

export const writeGmailCapturedMessageMetadata = async (input: {
  mailboxId: string;
  messageId: string;
  providerRevision: string;
  labelIds: string[];
  leaseId?: string;
}) => {
  const labelIds = input.labelIds
    .slice(0, 512)
    .map((label) => label.slice(0, 256));
  const now = new Date();
  await db.transaction(async (tx) => {
    if (input.leaseId) {
      await lockCaptureLease(tx, input.mailboxId, input.leaseId);
    }
    const accepted = await tx
      .update(gmailCapturedMessage)
      .set({
        providerRevision: input.providerRevision,
        snapshot: sql`jsonb_set(jsonb_set(${gmailCapturedMessage.snapshot}, '{labelIds}', ${JSON.stringify(labelIds)}::jsonb), '{providerRevision}', ${JSON.stringify(input.providerRevision)}::jsonb)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(gmailCapturedMessage.mailboxId, input.mailboxId),
          eq(gmailCapturedMessage.messageId, input.messageId),
          isNull(gmailCapturedMessage.deletedAt),
          sql`${gmailCapturedMessage.snapshot} is not null`,
          sql`${gmailCapturedMessage.providerRevision}::numeric <= ${input.providerRevision}::numeric`,
          sql`(${gmailCapturedMessage.providerRevision} <> ${input.providerRevision} or ${gmailCapturedMessage.snapshot}->'labelIds' is distinct from ${JSON.stringify(labelIds)}::jsonb)`
        )
      )
      .returning({ messageId: gmailCapturedMessage.messageId });
    if (accepted.length > 0) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: now,
        })
        .where(eq(mailbox.id, input.mailboxId));
    }
  });
};

const refreshRetainedMessage = async (input: {
  accessToken: string;
  mailboxId: string;
  messageId: string;
  providerRevision?: string;
  leaseId?: string;
}) => {
  const [retained] = await db
    .select({ revision: gmailCapturedMessage.providerRevision })
    .from(gmailCapturedMessage)
    .where(
      and(
        eq(gmailCapturedMessage.mailboxId, input.mailboxId),
        eq(gmailCapturedMessage.messageId, input.messageId),
        isNull(gmailCapturedMessage.deletedAt)
      )
    );
  if (retained === undefined) {
    return;
  }
  try {
    const metadata = await getGmailCaptureMetadata(
      input.accessToken,
      input.messageId
    );
    if (metadata.labelIds.includes(MAILBOX_LABELS.drafts)) {
      await deleteGmailCapturedMessage({
        ...input,
        providerRevision: metadata.providerRevision,
      });
      return;
    }
    await writeGmailCapturedMessageMetadata({ ...input, ...metadata });
  } catch (error) {
    if (!isGmailServiceError(error) || error.status !== 404) {
      throw error;
    }
    // A missing message carries no revision. Only the event/baseline or retained
    // revision is trustworthy, and an equal-revision tombstone must win.
    await deleteGmailCapturedMessage({
      ...input,
      providerRevision:
        BigInt(retained.revision) >
        BigInt(input.providerRevision ?? retained.revision)
          ? retained.revision
          : (input.providerRevision ?? retained.revision),
    });
  }
};

export const refreshGmailCapturedMessageMetadata = async (input: {
  accessToken: string;
  mailboxId: string;
  messageIds: string[];
}) => {
  if (input.messageIds.length === 0) {
    return;
  }
  const retained = await db
    .select({ messageId: gmailCapturedMessage.messageId })
    .from(gmailCapturedMessage)
    .where(
      and(
        eq(gmailCapturedMessage.mailboxId, input.mailboxId),
        inArray(gmailCapturedMessage.messageId, input.messageIds),
        isNull(gmailCapturedMessage.deletedAt)
      )
    );
  for (let offset = 0; offset < retained.length; offset += 10) {
    await Promise.all(
      retained.slice(offset, offset + 10).map(async ({ messageId }) => {
        await refreshRetainedMessage({ ...input, messageId });
      })
    );
  }
};

export const processGmailMailCapture = async (input: {
  accessToken: string;
  mailboxId: string;
  maxSteps?: number;
}): Promise<{ busy: boolean; needsContinuation: boolean }> => {
  const { accessToken, mailboxId } = input;
  const now = new Date();
  await db
    .insert(gmailCaptureState)
    .values({ createdAt: now, mailboxId, updatedAt: now })
    .onConflictDoNothing();
  const leaseId = randomUUID();
  const [claimed] = await db
    .update(gmailCaptureState)
    .set({
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      leaseId,
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailCaptureState.mailboxId, mailboxId),
        or(
          isNull(gmailCaptureState.leaseExpiresAt),
          lt(gmailCaptureState.leaseExpiresAt, now)
        )
      )
    )
    .returning();
  if (claimed === undefined) {
    return { busy: true, needsContinuation: true };
  }
  try {
    const deadline = Date.now() + 45_000;
    const maxSteps = Math.max(1, Math.min(200, input.maxSteps ?? 150));
    for (let step = 0; step < maxSteps && Date.now() < deadline; step += 1) {
      const [state] = await db
        .select()
        .from(gmailCaptureState)
        .where(
          and(
            eq(gmailCaptureState.mailboxId, mailboxId),
            eq(gmailCaptureState.leaseId, leaseId)
          )
        );
      if (state === undefined) {
        throw new Error("Mail capture state disappeared.");
      }
      if (!state.historyId) {
        const profile = await getGmailProfile(accessToken);
        if (!profile.historyId || !/^\d+$/u.test(profile.historyId)) {
          throw new Error("Mailbox has no reliable capture baseline.");
        }
        await checkpointCapture(mailboxId, leaseId, {
          historyId: profile.historyId,
        });
        continue;
      }
      if (state.phase === "pending") {
        const page = await listGmailMessageIds(accessToken, {
          includeSpamTrash: true,
          maxResults: 100,
          query: "-in:drafts",
        });
        await checkpointCapture(mailboxId, leaseId, {
          bootstrapMessageIds: page.messageIds.slice(0, 100),
          bootstrapOffset: 0,
          phase: "bootstrap",
        });
        continue;
      }
      if (state.phase === "bootstrap") {
        const messageId = state.bootstrapMessageIds?.[state.bootstrapOffset];
        if (messageId) {
          await captureMessage({
            accessToken,
            leaseId,
            mailboxId,
            messageId,
            providerRevision: state.historyId,
            source: "bootstrap",
          });
          await checkpointCapture(mailboxId, leaseId, {
            bootstrapOffset: state.bootstrapOffset + 1,
          });
        } else {
          await checkpointCapture(mailboxId, leaseId, {
            bootstrapCompletedAt: new Date(),
            phase: "history",
          });
        }
        continue;
      }
      if (state.phase === "history") {
        const page =
          state.pendingHistoryPage ??
          (await listGmailCaptureHistoryPage(accessToken, {
            pageToken: state.historyPageToken ?? undefined,
            startHistoryId: state.historyId,
          }));
        if ("historyExpired" in page && page.historyExpired === true) {
          const profile = await getGmailProfile(accessToken);
          if (!profile.historyId || !/^\d+$/u.test(profile.historyId)) {
            throw new Error("Mailbox has no reliable capture baseline.");
          }
          await checkpointCapture(mailboxId, leaseId, {
            coverageGapAt: state.coverageGapAt ?? new Date(),
            historyChangeOffset: 0,
            historyId: profile.historyId,
            historyPageToken: null,
            pendingHistoryPage: null,
            phase: "recovery",
            recoveryAfter: new Date(
              (state.lastCapturedAt ?? state.createdAt).getTime() -
                60 * 60 * 1000
            ),
            recoveryBefore: new Date(),
            recoveryOffset: 0,
            recoveryPageToken: null,
          });
          continue;
        }
        if (state.pendingHistoryPage === null) {
          await checkpointCapture(mailboxId, leaseId, {
            pendingHistoryPage: {
              changes: page.changes,
              historyId: page.historyId,
              nextPageToken: page.nextPageToken,
            },
          });
          continue;
        }
        const change = page.changes[state.historyChangeOffset];
        if (change !== undefined) {
          const args = { ...change, accessToken, leaseId, mailboxId };
          if (change.kind === "deleted") {
            await deleteGmailCapturedMessage(args);
          } else if (change.kind === "labels") {
            await refreshRetainedMessage(args);
          } else {
            await captureMessage({ ...args, source: "history" });
          }
          await checkpointCapture(mailboxId, leaseId, {
            historyChangeOffset: state.historyChangeOffset + 1,
          });
          continue;
        }
        await checkpointCapture(mailboxId, leaseId, {
          historyChangeOffset: 0,
          historyId: page.nextPageToken ? state.historyId : page.historyId,
          historyPageToken: page.nextPageToken,
          pendingHistoryPage: null,
          ...(page.nextPageToken ? {} : { lastCapturedAt: new Date() }),
        });
        if (!page.nextPageToken) {
          return { busy: false, needsContinuation: false };
        }
        continue;
      }
      if (state.phase === "recovery") {
        const after = state.recoveryAfter ?? state.createdAt;
        const before = state.recoveryBefore ?? new Date();
        const page =
          state.pendingRecoveryPage ??
          (await listGmailMessageIds(accessToken, {
            includeSpamTrash: true,
            maxResults: 100,
            pageToken: state.recoveryPageToken ?? undefined,
            query: `-in:drafts after:${Math.floor(after.getTime() / 1000)} before:${Math.ceil(before.getTime() / 1000)}`,
          }));
        if (state.pendingRecoveryPage === null) {
          await checkpointCapture(mailboxId, leaseId, {
            pendingRecoveryPage: {
              messageIds: page.messageIds,
              nextPageToken: page.nextPageToken ?? null,
            },
          });
          continue;
        }
        const messageId = page.messageIds[state.recoveryOffset];
        if (messageId) {
          await captureMessage({
            accessToken,
            leaseId,
            mailboxId,
            messageId,
            providerRevision: state.historyId,
            source: "recovery",
          });
          await checkpointCapture(mailboxId, leaseId, {
            recoveryOffset: state.recoveryOffset + 1,
          });
        } else {
          await checkpointCapture(mailboxId, leaseId, {
            pendingRecoveryPage: null,
            phase: page.nextPageToken ? "recovery" : "reconcile",
            reconcileAfterMessageId: null,
            recoveryOffset: 0,
            recoveryPageToken: page.nextPageToken ?? null,
          });
        }
        continue;
      }
      const [retained] = await db
        .select({ messageId: gmailCapturedMessage.messageId })
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxId),
            isNull(gmailCapturedMessage.deletedAt),
            state.reconcileAfterMessageId
              ? gt(
                  gmailCapturedMessage.messageId,
                  state.reconcileAfterMessageId
                )
              : undefined
          )
        )
        .orderBy(asc(gmailCapturedMessage.messageId))
        .limit(1);
      if (retained === undefined) {
        await checkpointCapture(mailboxId, leaseId, {
          phase: "history",
          reconcileAfterMessageId: null,
          recoveryAfter: null,
          recoveryBefore: null,
        });
      } else {
        await refreshRetainedMessage({
          accessToken,
          leaseId,
          mailboxId,
          messageId: retained.messageId,
          providerRevision: state.historyId,
        });
        await checkpointCapture(mailboxId, leaseId, {
          reconcileAfterMessageId: retained.messageId,
        });
      }
    }
    return { busy: false, needsContinuation: true };
  } catch (error) {
    await db
      .update(gmailCaptureState)
      .set({ lastErrorAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(gmailCaptureState.mailboxId, mailboxId),
          eq(gmailCaptureState.leaseId, leaseId)
        )
      );
    throw error;
  } finally {
    await db
      .update(gmailCaptureState)
      .set({ leaseExpiresAt: null, leaseId: null, updatedAt: new Date() })
      .where(
        and(
          eq(gmailCaptureState.mailboxId, mailboxId),
          eq(gmailCaptureState.leaseId, leaseId)
        )
      );
  }
};

export const getMailCaptureStatus = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const selected = await assertAccessibleMailbox(input);
  if (selected.provider === "managed") {
    const [retained] = await db
      .select({ count: count() })
      .from(managedMailMessage)
      .where(eq(managedMailMessage.mailboxId, input.mailboxId));
    return {
      bootstrapCompletedAt: null,
      coverageGapAt: null,
      lastCapturedAt: null,
      retainedMessages: retained?.count ?? 0,
      state: "current" as const,
    };
  }
  const [state] = await db
    .select()
    .from(gmailCaptureState)
    .where(eq(gmailCaptureState.mailboxId, input.mailboxId));
  const [retained] = await db
    .select({ count: count() })
    .from(gmailCapturedMessage)
    .where(
      and(
        eq(gmailCapturedMessage.mailboxId, input.mailboxId),
        isNull(gmailCapturedMessage.deletedAt)
      )
    );
  const replayPending =
    state !== undefined &&
    (state.lastCapturedAt === null ||
      state.pendingHistoryPage !== null ||
      state.historyPageToken !== null);
  const phaseStatus = {
    bootstrap: "importing",
    history: replayPending ? "syncing" : "current",
    pending: "pending",
    reconcile: "recovering",
    recovery: "recovering",
  } as const;
  const status = state?.lastErrorAt
    ? "retrying"
    : phaseStatus[state?.phase ?? "pending"];
  return {
    bootstrapCompletedAt: state?.bootstrapCompletedAt ?? null,
    coverageGapAt: state?.coverageGapAt ?? null,
    lastCapturedAt: state?.lastCapturedAt ?? null,
    retainedMessages: retained?.count ?? 0,
    state: status,
  };
};
