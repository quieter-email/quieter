import { randomUUID } from "node:crypto";

import { AI_CREDIT_ADMISSION_BUSY_MESSAGE } from "@quieter/billing/ai-credit-errors";
import { db } from "@quieter/database/client";
import {
  gmailAutoLabelEvent,
  gmailCaptureState,
  gmailSchedulerEnrollment,
  gmailWatchState,
  mailboxAutomationSettings,
  mailbox,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import {
  getGmailProfile,
  GmailBackgroundQuotaDeferredError,
  isGmailRateLimitedError,
  isGmailServiceError,
  listGmailCaptureHistoryPage,
  listGmailMessageIds,
  watchGmailMailbox,
} from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { autoLabelBudgetDeferred } from "../mail-automation/auto-label-events";
import { reportAutoLabelUsage } from "../mail-automation/usage";
import { processGmailMailCapture } from "../mail-capture";
import { appendMailboxChange, publishMailboxChange } from "../mailbox-changes";
import {
  listPendingMailboxVerificationCodeMessageIds,
  reportPendingMailboxVerificationCodeUsage,
} from "../verification-codes";
import {
  enqueueGmailMessageWork,
  hasPendingFreshGmailWork,
} from "./work-store";

const WATCH_RENEWAL_INTERVAL_MS = 1000 * 60 * 60 * 20;
const WATCH_EXPIRATION_BUFFER_MS = 1000 * 60 * 60 * 48;
// Queue and scheduled invocations can live for 15 minutes.
const PROCESSING_LEASE_MS = 1000 * 60 * 16;
const MAILBOX_RATE_LIMIT_RETRY_MS = 60_000;
const HISTORY_RECOVERY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 7;
const HISTORY_RECOVERY_OVERLAP_MS = 1000 * 60 * 60;
const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 2000)
    : "Unknown Gmail update error.";

const ensureWatchState = async (mailboxId: string) => {
  const now = new Date();
  await db
    .insert(gmailWatchState)
    .values({
      createdAt: now,
      mailboxId,
      updatedAt: now,
    })
    .onConflictDoNothing();
};

const claimMailboxProcessingLease = async (mailboxId: string) => {
  await ensureWatchState(mailboxId);

  const now = new Date();
  const leaseId = randomUUID();
  const [claimed] = await db
    .update(gmailWatchState)
    .set({
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      processingLeaseId: leaseId,
      processingWorkLeaseId: leaseId,
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailWatchState.mailboxId, mailboxId),
        or(
          isNull(gmailWatchState.providerRetryAt),
          lte(gmailWatchState.providerRetryAt, now)
        ),
        or(
          isNull(gmailWatchState.processingLeaseExpiresAt),
          lt(gmailWatchState.processingLeaseExpiresAt, now)
        )
      )
    )
    .returning({ mailboxId: gmailWatchState.mailboxId });

  return claimed === undefined ? null : leaseId;
};

const releaseMailboxProcessingLease = async (
  mailboxId: string,
  leaseId: string
) => {
  await db
    .update(gmailWatchState)
    .set({
      processingLeaseExpiresAt: null,
      processingLeaseId: null,
      processingWorkLeaseId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gmailWatchState.mailboxId, mailboxId),
        eq(gmailWatchState.processingLeaseId, leaseId)
      )
    );
};

const reportPendingAutoLabelUsage = async (
  mailboxId: string,
  userId: string
) => {
  const events = await db
    .select({
      cacheWriteTokens: gmailAutoLabelEvent.cacheWriteTokens,
      cachedTokens: gmailAutoLabelEvent.cachedTokens,
      completionTokens: gmailAutoLabelEvent.completionTokens,
      costUsd: gmailAutoLabelEvent.costUsd,
      id: gmailAutoLabelEvent.id,
      model: gmailAutoLabelEvent.model,
      promptTokens: gmailAutoLabelEvent.promptTokens,
      usageReportedAt: gmailAutoLabelEvent.usageReportedAt,
    })
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, mailboxId),
        isNull(gmailAutoLabelEvent.usageReportedAt)
      )
    )
    .limit(100);

  for (const event of events) {
    await reportAutoLabelUsage({ ...event, mailboxId, userId });
  }
};

export const retryPendingAutomationMessages = async ({
  autoLabelEnabled,
  mailboxId,
  organizationId,
  userId,
}: {
  autoLabelEnabled: boolean;
  mailboxId: string;
  organizationId: string | null;
  userId: string;
}) => {
  const now = new Date();
  const autoLabelEvents = autoLabelEnabled
    ? await db
        .select({
          gmailMessageId: gmailAutoLabelEvent.gmailMessageId,
          nextAttemptAt: gmailAutoLabelEvent.nextAttemptAt,
        })
        .from(gmailAutoLabelEvent)
        .where(
          and(
            eq(gmailAutoLabelEvent.mailboxId, mailboxId),
            isNull(gmailAutoLabelEvent.appliedAt),
            or(
              isNull(gmailAutoLabelEvent.nextAttemptAt),
              lte(gmailAutoLabelEvent.nextAttemptAt, now),
              and(
                autoLabelBudgetDeferred,
                ne(
                  gmailAutoLabelEvent.lastError,
                  AI_CREDIT_ADMISSION_BUSY_MESSAGE
                )
              )
            )
          )
        )
        .orderBy(
          desc(isNull(gmailAutoLabelEvent.nextAttemptAt)),
          asc(gmailAutoLabelEvent.nextAttemptAt)
        )
        .limit(20)
    : [];
  const pendingCodeMessageIds =
    await listPendingMailboxVerificationCodeMessageIds(mailboxId, 20);
  const budgetStatus = autoLabelEvents.some(
    (event) => event.nextAttemptAt !== null && event.nextAttemptAt > now
  )
    ? await getMailAutomationAiBudgetStatus({
        organizationId,
        userId,
      })
    : null;
  const resumeBudgetDeferred = budgetStatus?.allowed ?? false;

  await enqueueGmailMessageWork({
    mailboxId,
    messageIds: pendingCodeMessageIds,
    resumeCritical: true,
    source: "catchup",
  });
  await enqueueGmailMessageWork({
    mailboxId,
    messageIds: autoLabelEvents
      .filter(
        (event) =>
          event.nextAttemptAt === null ||
          event.nextAttemptAt <= now ||
          resumeBudgetDeferred
      )
      .map((event) => event.gmailMessageId),
    resumeCritical: true,
    source: "catchup",
  });
};

type WatchState = typeof gmailWatchState.$inferSelect;
type CaptureState = typeof gmailCaptureState.$inferSelect;
type HistoryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const watchLease = (mailboxId: string, leaseId: string) =>
  and(
    eq(gmailWatchState.mailboxId, mailboxId),
    eq(gmailWatchState.processingLeaseId, leaseId),
    gt(
      gmailWatchState.processingLeaseExpiresAt,
      sql`clock_timestamp() at time zone 'UTC'`
    )
  );

const checkpointWatch = async (
  client: Pick<typeof db, "update">,
  mailboxId: string,
  leaseId: string,
  changes: Partial<typeof gmailWatchState.$inferInsert>
) => {
  const [state] = await client
    .update(gmailWatchState)
    .set({ ...changes, updatedAt: new Date() })
    .where(watchLease(mailboxId, leaseId))
    .returning({ mailboxId: gmailWatchState.mailboxId });
  if (state === undefined) {
    throw new Error("Gmail history lease expired.");
  }
};

const checkpointCaptureHistory = async (
  tx: HistoryTransaction,
  capture: CaptureState,
  changes: Partial<typeof gmailCaptureState.$inferInsert>
) => {
  const [state] = await tx
    .update(gmailCaptureState)
    .set({ ...changes, updatedAt: new Date() })
    .where(
      and(
        eq(gmailCaptureState.mailboxId, capture.mailboxId),
        eq(gmailCaptureState.phase, "history"),
        eq(gmailCaptureState.historyId, capture.historyId ?? ""),
        isNull(gmailCaptureState.pendingHistoryPage),
        or(
          isNull(gmailCaptureState.leaseExpiresAt),
          lt(
            gmailCaptureState.leaseExpiresAt,
            sql`clock_timestamp() at time zone 'UTC'`
          )
        )
      )
    )
    .returning({ mailboxId: gmailCaptureState.mailboxId });
  if (state === undefined) {
    throw new Error("Mail capture changed while Gmail history was being read.");
  }
};

const resetExpiredHistory = async ({
  accessToken,
  capture,
  leaseId,
  watch,
}: {
  accessToken: string;
  capture: CaptureState | null;
  leaseId: string;
  watch: WatchState;
}) => {
  const profile = await getGmailProfile(accessToken);
  const { historyId } = profile;
  if (!historyId || !/^\d+$/u.test(historyId)) {
    throw new Error("Gmail profile did not include a valid history ID.");
  }
  const resetWatch =
    capture === null ||
    (watch.historyId !== null &&
      capture.historyId !== null &&
      BigInt(watch.historyId) === BigInt(capture.historyId));
  const expiredHistoryId = capture?.historyId ?? watch.historyId;
  if (
    expiredHistoryId !== null &&
    BigInt(historyId) <= BigInt(expiredHistoryId)
  ) {
    throw new Error("Gmail did not provide a newer history ID for recovery.");
  }
  const now = new Date();
  const earliestRecovery = now.getTime() - HISTORY_RECOVERY_LOOKBACK_MS;
  const desiredRecovery =
    (watch.lastReconciledAt?.getTime() ?? watch.createdAt.getTime()) -
    HISTORY_RECOVERY_OVERLAP_MS;
  const update = await db.transaction(async (tx) => {
    await checkpointWatch(
      tx,
      watch.mailboxId,
      leaseId,
      resetWatch
        ? {
            historyId,
            historyPageToken: null,
            recoveryAfter:
              watch.recoveryAfter ??
              new Date(Math.max(earliestRecovery, desiredRecovery)),
            recoveryBefore: now,
            recoveryPageToken: null,
          }
        : {}
    );
    if (capture !== null) {
      await checkpointCaptureHistory(tx, capture, {
        coverageGapAt: capture.coverageGapAt ?? now,
        historyChangeOffset: 0,
        historyId,
        historyPageToken: null,
        phase: "recovery",
        recoveryAfter: new Date(
          (capture.lastCapturedAt ?? capture.createdAt).getTime() -
            HISTORY_RECOVERY_OVERLAP_MS
        ),
        recoveryBefore: now,
        recoveryOffset: 0,
        recoveryPageToken: null,
      });
    }
    return await appendMailboxChange(tx, {
      changes: [{ kind: "mailbox.reconcile" }],
      mailboxId: watch.mailboxId,
    });
  });
  await publishMailboxChange(update);
};

const processHistoryRecoveryPage = async (
  accessToken: string,
  mailboxId: string,
  leaseId: string
) => {
  const [state] = await db
    .select({
      recoveryAfter: gmailWatchState.recoveryAfter,
      recoveryBefore: gmailWatchState.recoveryBefore,
      recoveryPageToken: gmailWatchState.recoveryPageToken,
    })
    .from(gmailWatchState)
    .where(watchLease(mailboxId, leaseId))
    .limit(1);
  if (!state?.recoveryAfter || !state.recoveryBefore) {
    return false;
  }

  const page = await listGmailMessageIds(accessToken, {
    maxResults: 25,
    pageToken: state.recoveryPageToken ?? undefined,
    query: `after:${Math.floor(state.recoveryAfter.getTime() / 1000)} before:${Math.ceil(
      state.recoveryBefore.getTime() / 1000
    )}`,
  });
  await db.transaction(async (tx) => {
    await checkpointWatch(tx, mailboxId, leaseId, {
      recoveryAfter: page.nextPageToken ? state.recoveryAfter : null,
      recoveryBefore: page.nextPageToken ? state.recoveryBefore : null,
      recoveryPageToken: page.nextPageToken ?? null,
    });
    await enqueueGmailMessageWork(
      { mailboxId, messageIds: page.messageIds, source: "catchup" },
      tx
    );
  });
  return Boolean(page.nextPageToken);
};

const isHistoryReplaying = (
  watch: WatchState | null,
  capture: CaptureState | null
) => {
  if (
    !watch?.historyId ||
    !capture?.historyId ||
    capture.phase !== "history" ||
    capture.pendingHistoryPage !== null ||
    watch.recoveryAfter !== null ||
    watch.historyPageToken !== null ||
    capture.historyPageToken !== null
  ) {
    return true;
  }
  return (
    BigInt(watch.historyId) !== BigInt(capture.historyId) ||
    (watch.lastProcessedAt !== null &&
      (watch.lastReconciledAt === null ||
        watch.lastProcessedAt > watch.lastReconciledAt))
  );
};

export const willNeedGmailFreshDiscovery = async (input: {
  mailboxId: string;
  observedHistoryId?: string;
}) => {
  const [state] = await db
    .select({ capture: gmailCaptureState, watch: gmailWatchState })
    .from(gmailWatchState)
    .leftJoin(
      gmailCaptureState,
      eq(gmailCaptureState.mailboxId, gmailWatchState.mailboxId)
    )
    .where(eq(gmailWatchState.mailboxId, input.mailboxId))
    .limit(1);
  return isHistoryReplaying(state?.watch ?? null, state?.capture ?? null);
};

const stageMailboxHistoryPage = async ({
  accessToken,
  capture,
  leaseId,
  notificationReceivedAt,
  observedHistoryId,
  watch,
}: {
  accessToken: string;
  capture: (CaptureState & { historyId: string }) | null;
  leaseId: string;
  notificationReceivedAt?: Date;
  observedHistoryId?: string;
  watch: WatchState & { historyId: string };
}) => {
  const { mailboxId } = watch;
  const watchRevision = BigInt(watch.historyId);
  const captureRevision = capture === null ? null : BigInt(capture.historyId);
  const captureIsBehind =
    captureRevision !== null && captureRevision <= watchRevision;
  const startHistoryId =
    capture !== null && captureIsBehind ? capture.historyId : watch.historyId;
  if (
    observedHistoryId !== undefined &&
    /^\d+$/u.test(observedHistoryId) &&
    BigInt(startHistoryId) >= BigInt(observedHistoryId) &&
    (capture === null || !isHistoryReplaying(watch, capture))
  ) {
    return { expired: false, hasMore: false, stagedCapture: false };
  }

  // Legacy tokens bind to different queries. Resume the all-change stream
  // from a complete history record and let the two revisions filter replay.
  const page = await listGmailCaptureHistoryPage(accessToken, {
    startHistoryId,
  });
  if (page.historyExpired) {
    await resetExpiredHistory({
      accessToken,
      capture: captureIsBehind ? capture : null,
      leaseId,
      watch,
    });
    return { expired: true, hasMore: true, stagedCapture: false };
  }

  const historyId = page.nextPageToken
    ? page.lastRecordHistoryId
    : page.historyId;
  if (
    historyId === null ||
    BigInt(historyId) < BigInt(startHistoryId) ||
    (page.nextPageToken && BigInt(historyId) === BigInt(startHistoryId))
  ) {
    throw new Error("Gmail history page did not include a usable checkpoint.");
  }
  const observed = page.changes.filter(
    (change) => BigInt(change.providerRevision) > watchRevision
  );
  const messageIds = observed.flatMap((change) =>
    change.kind === "added" ? [change.messageId] : []
  );
  const changes =
    captureRevision === null
      ? []
      : page.changes.filter(
          (change) => BigInt(change.providerRevision) > captureRevision
        );
  const now = new Date();
  const update = await db.transaction(async (tx) => {
    await checkpointWatch(tx, mailboxId, leaseId, {
      ...(BigInt(historyId) >= watchRevision
        ? { historyId, historyPageToken: null, lastProcessedAt: now }
        : {}),
      ...(page.nextPageToken === null ? { lastReconciledAt: now } : {}),
    });
    if (
      capture !== null &&
      captureRevision !== null &&
      BigInt(historyId) >= captureRevision
    ) {
      await checkpointCaptureHistory(tx, capture, {
        historyPageToken: null,
        ...(page.nextPageToken === null ? { lastCapturedAt: now } : {}),
        ...(changes.length > 0
          ? {
              historyChangeOffset: 0,
              pendingHistoryPage: { changes, historyId, nextPageToken: null },
            }
          : { historyId }),
      });
    }
    await enqueueGmailMessageWork(
      {
        liveArrival:
          notificationReceivedAt !== undefined &&
          observedHistoryId !== undefined &&
          capture !== null &&
          !isHistoryReplaying(watch, capture) &&
          page.nextPageToken === null,
        mailboxId,
        messageIds,
        notificationReceivedAt,
        source: "catchup",
        triggerActions: true,
      },
      tx
    );
    if (observed.length > 0) {
      return await appendMailboxChange(tx, {
        changes: observed.map(({ kind, messageId, threadId }) => ({
          kind: `message.${kind}`,
          messageId,
          threadId,
        })),
        mailboxId,
      });
    }
    return null;
  });
  await publishMailboxChange(update);
  return {
    expired: false,
    hasMore: page.nextPageToken !== null,
    stagedCapture: changes.length > 0,
  };
};

const watchRenewalAt = (state: {
  watchExpirationAt: Date | null;
  watchRenewedAt: Date | null;
}) =>
  state.watchRenewedAt === null || state.watchExpirationAt === null
    ? 0
    : Math.min(
        state.watchRenewedAt.getTime() + WATCH_RENEWAL_INTERVAL_MS,
        state.watchExpirationAt.getTime() - WATCH_EXPIRATION_BUFFER_MS
      );

const renewMailboxWatch = async ({
  accessToken,
  leaseId,
  mailboxId,
  topicName,
}: {
  accessToken: string;
  leaseId: string;
  mailboxId: string;
  topicName: string;
}) => {
  if (
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
    serverEnv.QUIETER_LOCAL_GMAIL_WATCH_OWNER !== "local"
  ) {
    return null;
  }
  const [state] = await db
    .select({
      watchExpirationAt: gmailWatchState.watchExpirationAt,
      watchRenewedAt: gmailWatchState.watchRenewedAt,
    })
    .from(gmailWatchState)
    .where(watchLease(mailboxId, leaseId))
    .limit(1);

  if (state === undefined) {
    return null;
  }
  const renewalAt = watchRenewalAt(state);
  if (renewalAt > Date.now()) {
    return renewalAt;
  }

  const watch = await watchGmailMailbox(accessToken, topicName);
  const renewed = {
    watchExpirationAt: watch.expiration,
    watchRenewedAt: new Date(),
  };
  await checkpointWatch(db, mailboxId, leaseId, renewed);
  return watchRenewalAt(renewed);
};

const processMailboxHistory = async ({
  mailboxId,
  maxHistoryPages,
  notificationReceivedAt,
  observedHistoryId,
  organizationId,
  topicName,
  userId,
}: {
  mailboxId: string;
  maxHistoryPages: number;
  notificationReceivedAt?: Date;
  observedHistoryId?: string;
  organizationId: string | null;
  topicName?: string;
  userId: string;
}) => {
  const leaseId = await claimMailboxProcessingLease(mailboxId);
  if (!leaseId) {
    const [state] = await db
      .select({
        processingLeaseExpiresAt: gmailWatchState.processingLeaseExpiresAt,
        providerRetryAt: gmailWatchState.providerRetryAt,
      })
      .from(gmailWatchState)
      .where(eq(gmailWatchState.mailboxId, mailboxId))
      .limit(1);
    return {
      busy: true as const,
      needsContinuation: false,
      needsFreshDiscovery: false,
      retryAfterMs: Math.max(
        (state?.providerRetryAt?.getTime() ?? 0) - Date.now(),
        Math.min(
          MAILBOX_RATE_LIMIT_RETRY_MS,
          Math.max(
            1000,
            (state?.processingLeaseExpiresAt?.getTime() ?? Date.now()) -
              Date.now()
          )
        )
      ),
    };
  }
  try {
    return await runAuthorizedGmailMailbox(
      { mailboxId, userId },
      async (accessToken) => {
        const nextWatchAt =
          topicName === undefined
            ? null
            : await renewMailboxWatch({
                accessToken,
                leaseId,
                mailboxId,
                topicName,
              });
        let capturePending = true;
        try {
          if (!(await hasPendingFreshGmailWork(mailboxId))) {
            const capture = await processGmailMailCapture({
              accessToken,
              mailboxId,
            });
            capturePending = capture.needsContinuation;
          }
        } catch (error) {
          if (
            error instanceof GmailBackgroundQuotaDeferredError ||
            isGmailRateLimitedError(error) ||
            (isGmailServiceError(error) && error.status === 401)
          ) {
            throw error;
          }
          reportError(error, { operation: "gmail-sync:mail-capture" });
        }

        let historyPending = false;
        let historyExpired = false;
        for (let pageIndex = 0; pageIndex < maxHistoryPages; pageIndex += 1) {
          const [state] = await db
            .select({ capture: gmailCaptureState, watch: gmailWatchState })
            .from(gmailWatchState)
            .leftJoin(
              gmailCaptureState,
              eq(gmailCaptureState.mailboxId, gmailWatchState.mailboxId)
            )
            .where(watchLease(mailboxId, leaseId))
            .limit(1);
          if (state === undefined) {
            throw new Error("Gmail history lease expired.");
          }
          const { watch, capture } = state;
          if (!watch.historyId) {
            await resetExpiredHistory({
              accessToken,
              capture: null,
              leaseId,
              watch,
            });
            historyPending = true;
            historyExpired = true;
            break;
          }

          const page = await stageMailboxHistoryPage({
            accessToken,
            capture:
              capture?.phase === "history" &&
              capture.pendingHistoryPage === null &&
              capture.historyId &&
              (!capture.leaseExpiresAt || capture.leaseExpiresAt <= new Date())
                ? { ...capture, historyId: capture.historyId }
                : null,
            leaseId,
            notificationReceivedAt,
            observedHistoryId,
            watch: { ...watch, historyId: watch.historyId },
          });
          historyPending = page.hasMore;
          historyExpired = page.expired;
          capturePending ||= page.stagedCapture;
          if (page.expired || page.stagedCapture || !page.hasMore) {
            break;
          }
        }
        const recoveryPending =
          historyExpired ||
          (await processHistoryRecoveryPage(accessToken, mailboxId, leaseId));
        const [automationSettings] = await db
          .select({
            autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
          })
          .from(mailboxAutomationSettings)
          .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
          .limit(1);
        await retryPendingAutomationMessages({
          autoLabelEnabled: automationSettings?.autoLabelEnabled ?? false,
          mailboxId,
          organizationId,
          userId,
        });
        await reportPendingAutoLabelUsage(mailboxId, userId);
        await reportPendingMailboxVerificationCodeUsage(mailboxId, userId);
        await checkpointWatch(db, mailboxId, leaseId, {
          lastError: null,
          lastErrorAt: null,
        });
        return {
          busy: false as const,
          needsContinuation:
            historyPending || capturePending || recoveryPending,
          needsFreshDiscovery: historyPending || recoveryPending,
          nextWatchAt,
        };
      }
    );
  } catch (error) {
    if (error instanceof GmailBackgroundQuotaDeferredError) {
      return {
        busy: true as const,
        needsContinuation: true,
        needsFreshDiscovery: false,
        retryAfterMs: Math.max(1000, error.retryAt - Date.now()),
      };
    }
    const now = new Date();
    const retryAfterMs = isGmailRateLimitedError(error)
      ? Math.max(1000, error.retryAfterMs ?? MAILBOX_RATE_LIMIT_RETRY_MS)
      : undefined;
    const [state] = await db
      .update(gmailWatchState)
      .set({
        lastError: getErrorMessage(error),
        lastErrorAt: now,
        ...(retryAfterMs === undefined
          ? {}
          : {
              providerRetryAt: sql`greatest(${gmailWatchState.providerRetryAt}, ${new Date(now.getTime() + retryAfterMs)})`,
            }),
        updatedAt: now,
      })
      .where(watchLease(mailboxId, leaseId))
      .returning({ providerRetryAt: gmailWatchState.providerRetryAt });
    if (retryAfterMs !== undefined) {
      return {
        busy: true as const,
        needsContinuation: true,
        needsFreshDiscovery: false,
        retryAfterMs: Math.max(
          1000,
          (state?.providerRetryAt?.getTime() ?? now.getTime() + retryAfterMs) -
            Date.now()
        ),
      };
    }
    throw error;
  } finally {
    await releaseMailboxProcessingLease(mailboxId, leaseId);
  }
};

const enrollLegacyGmailMailboxes = async (limit: number) => {
  const key = "mailbox-scheduler-v1";
  await db.transaction(async (tx) => {
    await tx
      .insert(gmailSchedulerEnrollment)
      .values({ key })
      .onConflictDoNothing();
    const [page] = await tx
      .select()
      .from(gmailSchedulerEnrollment)
      .where(eq(gmailSchedulerEnrollment.key, key))
      .for("update");
    if (page === undefined || page.completedAt !== null) {
      return;
    }
    const mailboxes = await tx
      .select({ mailboxId: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.provider, "gmail"),
          eq(mailbox.status, "connected"),
          page.afterMailboxId === null
            ? undefined
            : gt(mailbox.id, page.afterMailboxId)
        )
      )
      .orderBy(asc(mailbox.id))
      .limit(limit)
      .for("key share");
    const now = new Date();
    if (mailboxes.length > 0) {
      await tx
        .insert(gmailWatchState)
        .values(
          mailboxes.map(({ mailboxId }) => ({
            createdAt: now,
            mailboxId,
            updatedAt: now,
          }))
        )
        .onConflictDoNothing();
    }
    await tx
      .update(gmailSchedulerEnrollment)
      .set({
        afterMailboxId: mailboxes.at(-1)?.mailboxId ?? page.afterMailboxId,
        completedAt: mailboxes.length < limit ? now : null,
      })
      .where(eq(gmailSchedulerEnrollment.key, key));
  });
};

export const claimGmailSchedulerRepairs = async (limit = 500) => {
  await enrollLegacyGmailMailboxes(limit);
  const now = new Date();
  const repairAt = sql`coalesce(${gmailWatchState.schedulerRepairAt}, '-infinity'::timestamp)`;
  return await db.transaction(async (tx) => {
    const due = tx
      .select({ id: gmailWatchState.mailboxId })
      .from(gmailWatchState)
      .innerJoin(mailbox, eq(mailbox.id, gmailWatchState.mailboxId))
      .where(and(eq(mailbox.status, "connected"), lte(repairAt, now)))
      .orderBy(asc(repairAt), asc(gmailWatchState.mailboxId))
      .limit(limit)
      .for("update", { of: gmailWatchState, skipLocked: true });
    return await tx
      .update(gmailWatchState)
      .set({ schedulerRepairAt: new Date(now.getTime() + 10 * 60_000) })
      .where(inArray(gmailWatchState.mailboxId, due))
      .returning({ mailboxId: gmailWatchState.mailboxId });
  });
};

export const recordGmailSchedulerHeartbeat = async (mailboxId: string) => {
  await db
    .update(gmailWatchState)
    .set({ schedulerRepairAt: new Date(Date.now() + 4 * 60 * 60_000) })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
};

export const maintainGmailPubSubMailbox = async (input: {
  mailboxId: string;
  notificationReceivedAt?: number;
  observedHistoryId?: string;
  topicName: string;
}) => {
  const [gmailMailbox] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.ownerUserId,
      status: mailbox.status,
    })
    .from(mailbox)
    .where(and(eq(mailbox.id, input.mailboxId), eq(mailbox.provider, "gmail")))
    .limit(1);

  if (gmailMailbox === undefined) {
    return { status: "retired" as const };
  }
  if (!gmailMailbox.ownerUserId || gmailMailbox.status !== "connected") {
    return { status: "skipped" as const };
  }

  const result = await processMailboxHistory({
    mailboxId: gmailMailbox.id,
    maxHistoryPages: 2,
    notificationReceivedAt:
      input.notificationReceivedAt === undefined
        ? undefined
        : new Date(input.notificationReceivedAt),
    observedHistoryId: input.observedHistoryId,
    organizationId: gmailMailbox.organizationId,
    topicName: input.topicName,
    userId: gmailMailbox.ownerUserId,
  });
  if (result.busy) {
    return { retryAfterMs: result.retryAfterMs, status: "busy" as const };
  }
  return {
    needsFreshDiscovery: result.needsFreshDiscovery,
    nextWatchAt: result.nextWatchAt,
    status: result.needsContinuation
      ? ("pending" as const)
      : ("maintained" as const),
  };
};

export type GmailPubSubNotificationMessage = {
  emailAddress: string;
  historyId: string;
  pubSubMessageId: string;
};

export const findConnectedGmailMailbox = async (emailAddress: string) => {
  const [gmailMailbox] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.ownerUserId,
      status: mailbox.status,
    })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.emailAddress, emailAddress.trim().toLowerCase()),
        eq(mailbox.provider, "gmail")
      )
    )
    .limit(1);

  if (!gmailMailbox?.ownerUserId || gmailMailbox.status !== "connected") {
    return null;
  }

  return { ...gmailMailbox, ownerUserId: gmailMailbox.ownerUserId };
};

export const processGmailPubSubNotification = async (
  input: GmailPubSubNotificationMessage,
  options?: {
    maxHistoryPages?: number;
    onAccepted?: (input: { mailboxId: string }) => Promise<void>;
    onProcessed?: (input: { mailboxId: string }) => Promise<void>;
  }
) => {
  const gmailMailbox = await findConnectedGmailMailbox(input.emailAddress);
  if (gmailMailbox === null) {
    return { ignored: true as const, reason: "mailbox_not_connected" as const };
  }

  const notificationReceivedAt = new Date();
  await ensureWatchState(gmailMailbox.id);
  await db
    .update(gmailWatchState)
    .set({
      lastNotificationAt: notificationReceivedAt,
      updatedAt: notificationReceivedAt,
    })
    .where(eq(gmailWatchState.mailboxId, gmailMailbox.id));

  await options?.onAccepted?.({ mailboxId: gmailMailbox.id });

  const result = await processMailboxHistory({
    mailboxId: gmailMailbox.id,
    maxHistoryPages: options?.maxHistoryPages ?? 5,
    notificationReceivedAt,
    observedHistoryId: input.historyId,
    organizationId: gmailMailbox.organizationId,
    userId: gmailMailbox.ownerUserId,
  });
  if (!result.busy) {
    await options?.onProcessed?.({ mailboxId: gmailMailbox.id });
  }

  return {
    busy: result.busy,
    ignored: false as const,
    mailboxId: gmailMailbox.id,
    needsContinuation: result.needsContinuation,
    pubSubMessageId: input.pubSubMessageId,
    ...(result.busy ? { retryAfterMs: result.retryAfterMs } : {}),
  };
};
