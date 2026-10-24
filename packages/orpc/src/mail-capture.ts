import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  gmailCaptureState,
  managedMailMessage,
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
import { and, asc, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

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
    await tx
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
        setWhere: sql`${gmailCapturedMessage.providerRevision}::numeric < ${snapshot.providerRevision}::numeric or (${gmailCapturedMessage.providerRevision}::numeric = ${snapshot.providerRevision}::numeric and ${gmailCapturedMessage.deletedAt} is null)`,
        target: [
          gmailCapturedMessage.mailboxId,
          gmailCapturedMessage.messageId,
        ],
      });
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
    await tx
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
      });
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

const refreshRetainedMessage = async (input: {
  accessToken: string;
  mailboxId: string;
  messageId: string;
  providerRevision: string;
  leaseId: string;
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
    await db.transaction(async (tx) => {
      await lockCaptureLease(tx, input.mailboxId, input.leaseId);
      await tx
        .update(gmailCapturedMessage)
        .set({
          providerRevision: metadata.providerRevision,
          snapshot: sql`jsonb_set(jsonb_set(${gmailCapturedMessage.snapshot}, '{labelIds}', ${JSON.stringify(metadata.labelIds.slice(0, 512))}::jsonb), '{providerRevision}', ${JSON.stringify(metadata.providerRevision)}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, input.mailboxId),
            eq(gmailCapturedMessage.messageId, input.messageId),
            isNull(gmailCapturedMessage.deletedAt),
            sql`${gmailCapturedMessage.providerRevision}::numeric <= ${metadata.providerRevision}::numeric`
          )
        );
    });
  } catch (error) {
    if (!isGmailServiceError(error) || error.status !== 404) {
      throw error;
    }
    // A missing message carries no revision. Only the event/baseline or retained
    // revision is trustworthy, and an equal-revision tombstone must win.
    await deleteGmailCapturedMessage({
      ...input,
      providerRevision:
        BigInt(retained.revision) > BigInt(input.providerRevision)
          ? retained.revision
          : input.providerRevision,
    });
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
