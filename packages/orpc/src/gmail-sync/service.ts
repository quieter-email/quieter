import { randomUUID } from "node:crypto";

import { AI_CREDIT_ADMISSION_BUSY_MESSAGE } from "@quieter/billing/ai-credit-errors";
import { db } from "@quieter/database/client";
import {
  gmailAutoLabelEvent,
  gmailCaptureState,
  gmailWatchState,
  mailboxAutomationSettings,
  mailbox,
  mailboxVerificationCode,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import {
  getGmailProfile,
  isGmailRateLimitedError,
  listGmailAddedMessageHistoryPage,
  listGmailMessageIds,
  watchGmailMailbox,
} from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  isNotNull,
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
import {
  listPendingMailboxVerificationCodeMessageIds,
  reportPendingMailboxVerificationCodeUsage,
} from "../verification-codes";
import {
  deferGmailMailboxProvider,
  enqueueGmailMessageWork,
  getGmailMailboxProviderRetryAt,
  hasPendingFreshGmailWorkForAccount,
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

const ensureWatchState = async (mailboxId: string, historyId?: string) => {
  const now = new Date();
  await db
    .insert(gmailWatchState)
    .values({
      createdAt: now,
      historyId,
      mailboxId,
      updatedAt: now,
    })
    .onConflictDoNothing();
};

const recordWatchError = async (mailboxId: string, error: unknown) => {
  const now = new Date();
  await ensureWatchState(mailboxId);
  await db
    .update(gmailWatchState)
    .set({
      lastError: getErrorMessage(error),
      lastErrorAt: now,
      updatedAt: now,
    })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
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

const extendMailboxProcessingLease = async (
  mailboxId: string,
  leaseId: string
) => {
  const now = new Date();
  await db
    .update(gmailWatchState)
    .set({
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailWatchState.mailboxId, mailboxId),
        eq(gmailWatchState.processingLeaseId, leaseId)
      )
    );
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

const beginHistoryRecovery = async (
  accessToken: string,
  mailboxId: string,
  lastProcessedAt: Date | null
) => {
  const profile = await getGmailProfile(accessToken);
  if (!profile.historyId) {
    throw new Error("Gmail profile did not include a history ID.");
  }

  const now = new Date();
  const earliestRecovery = now.getTime() - HISTORY_RECOVERY_LOOKBACK_MS;
  const desiredRecovery =
    (lastProcessedAt?.getTime() ?? earliestRecovery) -
    HISTORY_RECOVERY_OVERLAP_MS;

  await db
    .update(gmailWatchState)
    .set({
      historyId: profile.historyId,
      historyPageToken: null,
      recoveryAfter: new Date(Math.max(earliestRecovery, desiredRecovery)),
      recoveryBefore: now,
      recoveryPageToken: null,
      updatedAt: now,
    })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
};

const processHistoryRecoveryPage = async ({
  accessToken,
  mailboxId,
}: {
  accessToken: string;
  mailboxId: string;
}) => {
  const [state] = await db
    .select({
      recoveryAfter: gmailWatchState.recoveryAfter,
      recoveryBefore: gmailWatchState.recoveryBefore,
      recoveryPageToken: gmailWatchState.recoveryPageToken,
    })
    .from(gmailWatchState)
    .where(eq(gmailWatchState.mailboxId, mailboxId))
    .limit(1);

  if (
    state === undefined ||
    state.recoveryAfter === null ||
    state.recoveryAfter === undefined ||
    state.recoveryBefore === null ||
    state.recoveryBefore === undefined
  ) {
    return;
  }

  const page = await listGmailMessageIds(accessToken, {
    maxResults: 25,
    pageToken: state.recoveryPageToken ?? undefined,
    query: `after:${Math.floor(state.recoveryAfter.getTime() / 1000)} before:${Math.floor(
      state.recoveryBefore.getTime() / 1000
    )}`,
  });
  await enqueueGmailMessageWork({
    mailboxId,
    messageIds: page.messageIds,
    source: "catchup",
  });

  await db
    .update(gmailWatchState)
    .set({
      recoveryAfter: page.nextPageToken ? state.recoveryAfter : null,
      recoveryBefore: page.nextPageToken ? state.recoveryBefore : null,
      recoveryPageToken: page.nextPageToken ?? null,
      updatedAt: new Date(),
    })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
};

const processMailboxHistory = async ({
  mailboxId,
  maxHistoryPages,
  organizationId,
  userId,
}: {
  mailboxId: string;
  maxHistoryPages: number;
  organizationId: string | null;
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
      busy: true,
      needsContinuation: false,
      retryAfterMs: Math.max(
        state?.providerRetryAt === null || state?.providerRetryAt === undefined
          ? 0
          : state.providerRetryAt.getTime() - Date.now(),
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
  let captureNeedsContinuation = false;
  try {
    try {
      if (await hasPendingFreshGmailWorkForAccount(mailboxId)) {
        captureNeedsContinuation = true;
      } else {
        const capture = await runAuthorizedGmailMailbox(
          { mailboxId, userId },
          async (accessToken) =>
            await processGmailMailCapture({ accessToken, mailboxId })
        );
        captureNeedsContinuation = capture.needsContinuation;
      }
    } catch (error) {
      if (isGmailRateLimitedError(error)) {
        throw error;
      }
      reportError(error, { operation: "gmail-sync:mail-capture" });
    }
    const needsContinuation = await runAuthorizedGmailMailbox(
      { mailboxId, userId },
      async (accessToken) => {
        const [automationSettings] = await db
          .select({
            autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
          })
          .from(mailboxAutomationSettings)
          .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
          .limit(1);
        const autoLabelEnabled = automationSettings?.autoLabelEnabled ?? false;
        for (let pageIndex = 0; pageIndex < maxHistoryPages; pageIndex += 1) {
          const [state] = await db
            .select({
              historyId: gmailWatchState.historyId,
              historyPageToken: gmailWatchState.historyPageToken,
              lastProcessedAt: gmailWatchState.lastProcessedAt,
            })
            .from(gmailWatchState)
            .where(eq(gmailWatchState.mailboxId, mailboxId))
            .limit(1);
          if (!state?.historyId) {
            await beginHistoryRecovery(
              accessToken,
              mailboxId,
              state?.lastProcessedAt ?? null
            );
            break;
          }

          const page = await listGmailAddedMessageHistoryPage(accessToken, {
            pageToken: state.historyPageToken ?? undefined,
            startHistoryId: state.historyId,
          });
          if (page.historyExpired) {
            await beginHistoryRecovery(
              accessToken,
              mailboxId,
              state.lastProcessedAt
            );
            break;
          }

          await enqueueGmailMessageWork({
            mailboxId,
            messageIds: page.messageIds,
            source: "catchup",
            triggerActions: true,
          });
          const now = new Date();
          await db
            .update(gmailWatchState)
            .set({
              historyId: page.nextPageToken ? state.historyId : page.historyId,
              historyPageToken: page.nextPageToken ?? null,
              lastError: null,
              lastErrorAt: null,
              lastProcessedAt: now,
              updatedAt: now,
            })
            .where(eq(gmailWatchState.mailboxId, mailboxId));
          await extendMailboxProcessingLease(mailboxId, leaseId);

          if (!page.nextPageToken) {
            break;
          }
        }

        await processHistoryRecoveryPage({
          accessToken,
          mailboxId,
        });
        await retryPendingAutomationMessages({
          autoLabelEnabled,
          mailboxId,
          organizationId,
          userId,
        });
        await reportPendingAutoLabelUsage(mailboxId, userId);
        await reportPendingMailboxVerificationCodeUsage(mailboxId, userId);
        const [remaining] = await db
          .select({
            historyPageToken: gmailWatchState.historyPageToken,
            recoveryAfter: gmailWatchState.recoveryAfter,
            recoveryPageToken: gmailWatchState.recoveryPageToken,
          })
          .from(gmailWatchState)
          .where(eq(gmailWatchState.mailboxId, mailboxId))
          .limit(1);
        if (remaining === undefined) {
          throw new Error("Gmail watch state disappeared during processing.");
        }
        const hasRemainingPages =
          remaining.historyPageToken !== null ||
          remaining.recoveryAfter !== null ||
          remaining.recoveryPageToken !== null;
        const now = new Date();
        await db
          .update(gmailWatchState)
          .set({
            lastError: null,
            lastErrorAt: null,
            ...(hasRemainingPages ? {} : { lastReconciledAt: now }),
            updatedAt: now,
          })
          .where(eq(gmailWatchState.mailboxId, mailboxId));
        return hasRemainingPages;
      }
    );

    return {
      busy: false,
      needsContinuation: needsContinuation || captureNeedsContinuation,
    };
  } catch (error) {
    await recordWatchError(mailboxId, error);
    if (isGmailRateLimitedError(error)) {
      const retryAt = await deferGmailMailboxProvider(
        mailboxId,
        new Date(
          Date.now() +
            Math.max(1000, error.retryAfterMs ?? MAILBOX_RATE_LIMIT_RETRY_MS)
        )
      );
      return {
        busy: true,
        needsContinuation: true,
        retryAfterMs: Math.max(1000, retryAt.getTime() - Date.now()),
      };
    }
    throw error;
  } finally {
    await releaseMailboxProcessingLease(mailboxId, leaseId);
  }
};

const shouldRenewWatch = (state: {
  watchExpirationAt: Date | null;
  watchRenewedAt: Date | null;
}) => {
  const now = Date.now();
  return (
    !state.watchRenewedAt ||
    !state.watchExpirationAt ||
    state.watchRenewedAt.getTime() <= now - WATCH_RENEWAL_INTERVAL_MS ||
    state.watchExpirationAt.getTime() <= now + WATCH_EXPIRATION_BUFFER_MS
  );
};

const renewMailboxWatch = async ({
  mailboxId,
  topicName,
  userId,
}: {
  mailboxId: string;
  topicName: string;
  userId: string;
}) => {
  if (
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
    serverEnv.QUIETER_LOCAL_GMAIL_WATCH_OWNER !== "local"
  ) {
    await ensureWatchState(mailboxId);
    return;
  }
  await ensureWatchState(mailboxId);
  const [state] = await db
    .select({
      historyId: gmailWatchState.historyId,
      watchExpirationAt: gmailWatchState.watchExpirationAt,
      watchRenewedAt: gmailWatchState.watchRenewedAt,
    })
    .from(gmailWatchState)
    .where(eq(gmailWatchState.mailboxId, mailboxId))
    .limit(1);

  if (state === undefined || !shouldRenewWatch(state)) {
    return;
  }

  const watch = await runAuthorizedGmailMailbox(
    { mailboxId, userId },
    async (accessToken) => await watchGmailMailbox(accessToken, topicName)
  );
  const now = new Date();
  await db
    .update(gmailWatchState)
    .set({
      historyId: state.historyId ?? watch.historyId,
      lastError: null,
      lastErrorAt: null,
      updatedAt: now,
      watchExpirationAt: watch.expiration,
      watchRenewedAt: now,
    })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
};

// Renew expiring watches; each maintenance run also reconciles missed notifications.
export const listGmailPubSubMaintenanceJobs = async (limit = 500) => {
  const captureDue = or(
    isNull(gmailCaptureState.mailboxId),
    isNotNull(gmailCaptureState.historyPageToken),
    isNotNull(gmailCaptureState.pendingHistoryPage),
    sql`${gmailCaptureState.phase} <> 'history'`,
    isNull(gmailCaptureState.lastCapturedAt),
    lte(gmailCaptureState.lastCapturedAt, sql`now() - interval '2 hours'`)
  );
  return await db
    .select({
      emailAddress: mailbox.emailAddress,
      mailboxId: mailbox.id,
    })
    .from(mailbox)
    .leftJoin(gmailWatchState, eq(gmailWatchState.mailboxId, mailbox.id))
    .leftJoin(gmailCaptureState, eq(gmailCaptureState.mailboxId, mailbox.id))
    .where(
      and(
        eq(mailbox.provider, "gmail"),
        eq(mailbox.status, "connected"),
        or(
          isNull(gmailWatchState.providerRetryAt),
          lte(gmailWatchState.providerRetryAt, sql`now()`)
        ),
        or(
          captureDue,
          isNull(gmailWatchState.mailboxId),
          isNull(gmailWatchState.watchExpirationAt),
          lte(
            gmailWatchState.watchExpirationAt,
            sql`now() + interval '72 hours'`
          ),
          lte(
            gmailWatchState.watchRenewedAt,
            sql`now() - interval '36 hours' - make_interval(secs => ((('x' || md5(${mailbox.id}))::bit(32)::int & 2147483647) % 7200))`
          ),
          isNull(gmailWatchState.lastReconciledAt),
          isNotNull(gmailWatchState.historyPageToken),
          isNotNull(gmailWatchState.recoveryAfter),
          isNotNull(gmailWatchState.recoveryPageToken),
          lte(
            gmailWatchState.lastReconciledAt,
            sql`now() - interval '2 hours'`
          ),
          exists(
            db
              .select({ id: gmailAutoLabelEvent.id })
              .from(gmailAutoLabelEvent)
              .innerJoin(
                mailboxAutomationSettings,
                eq(
                  mailboxAutomationSettings.mailboxId,
                  gmailAutoLabelEvent.mailboxId
                )
              )
              .where(
                and(
                  eq(gmailAutoLabelEvent.mailboxId, mailbox.id),
                  eq(mailboxAutomationSettings.autoLabelEnabled, true),
                  and(
                    autoLabelBudgetDeferred,
                    ne(
                      gmailAutoLabelEvent.lastError,
                      AI_CREDIT_ADMISSION_BUSY_MESSAGE
                    )
                  )
                )
              )
          ),
          exists(
            db
              .select({ id: mailboxVerificationCode.id })
              .from(mailboxVerificationCode)
              .where(
                and(
                  eq(mailboxVerificationCode.mailboxId, mailbox.id),
                  isNull(mailboxVerificationCode.processedAt),
                  gt(
                    mailboxVerificationCode.createdAt,
                    sql`now() - interval '2 hours'`
                  ),
                  or(
                    isNull(mailboxVerificationCode.leaseUntil),
                    lt(mailboxVerificationCode.leaseUntil, sql`now()`)
                  ),
                  or(
                    isNull(mailboxVerificationCode.nextAttemptAt),
                    lte(mailboxVerificationCode.nextAttemptAt, sql`now()`)
                  )
                )
              )
          )
        ),
        or(
          captureDue,
          isNull(gmailWatchState.lastErrorAt),
          lte(gmailWatchState.lastErrorAt, sql`now() - interval '1 hour'`)
        )
      )
    )
    .orderBy(
      desc(isNull(gmailWatchState.lastReconciledAt)),
      asc(gmailWatchState.lastReconciledAt)
    )
    .limit(limit);
};

export const maintainGmailPubSubMailbox = async (input: {
  mailboxId: string;
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

  if (!gmailMailbox?.ownerUserId) {
    return { status: "skipped" as const };
  }

  try {
    if (gmailMailbox.status !== "connected") {
      return { status: "skipped" as const };
    }
    const providerRetryAt = await getGmailMailboxProviderRetryAt(
      gmailMailbox.id
    );
    if (providerRetryAt !== null && providerRetryAt.getTime() > Date.now()) {
      return { status: "busy" as const };
    }

    await renewMailboxWatch({
      mailboxId: gmailMailbox.id,
      topicName: input.topicName,
      userId: gmailMailbox.ownerUserId,
    });
    const result = await processMailboxHistory({
      mailboxId: gmailMailbox.id,
      maxHistoryPages: 2,
      organizationId: gmailMailbox.organizationId,
      userId: gmailMailbox.ownerUserId,
    });
    if (result.busy) {
      return { status: "busy" as const };
    }
    return {
      status: result.needsContinuation
        ? ("pending" as const)
        : ("maintained" as const),
    };
  } catch (error) {
    if (isGmailRateLimitedError(error)) {
      await deferGmailMailboxProvider(
        gmailMailbox.id,
        new Date(
          Date.now() +
            Math.max(1000, error.retryAfterMs ?? MAILBOX_RATE_LIMIT_RETRY_MS)
        )
      );
    }
    await recordWatchError(gmailMailbox.id, error);
    throw error;
  }
};

export type GmailPubSubNotificationMessage = {
  emailAddress: string;
  historyId: string;
  pubSubMessageId: string;
};

export const processGmailPubSubNotification = async (
  input: GmailPubSubNotificationMessage,
  options?: {
    maxHistoryPages?: number;
    onAccepted?: (input: { mailboxId: string }) => Promise<void>;
    onProcessed?: (input: { mailboxId: string }) => Promise<void>;
  }
) => {
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
        eq(mailbox.emailAddress, input.emailAddress.trim().toLowerCase()),
        eq(mailbox.provider, "gmail")
      )
    )
    .limit(1);

  if (!gmailMailbox?.ownerUserId || gmailMailbox.status !== "connected") {
    return { ignored: true as const, reason: "mailbox_not_connected" as const };
  }

  await ensureWatchState(gmailMailbox.id);
  await db
    .update(gmailWatchState)
    .set({
      lastNotificationAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(gmailWatchState.mailboxId, gmailMailbox.id));

  await options?.onAccepted?.({ mailboxId: gmailMailbox.id });

  const result = await processMailboxHistory({
    mailboxId: gmailMailbox.id,
    maxHistoryPages: options?.maxHistoryPages ?? 5,
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
    ...(result.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: result.retryAfterMs }),
  };
};
