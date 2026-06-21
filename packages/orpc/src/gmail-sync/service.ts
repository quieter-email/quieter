import {
  classifyGmailMessage,
  GMAIL_AUTO_LABEL_MODEL,
  type ChatMiddleware,
  type GmailAutoLabelCandidate,
} from "@quieter/ai";
import { reportAiUsage } from "@quieter/billing";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import {
  db,
  gmailAutoLabelEvent,
  gmailAutoLabelSettings,
  gmailUsefulDetailSettings,
  gmailWatchState,
  mailbox,
} from "@quieter/database";
import {
  getGmailProfile,
  getMessageWithDetails,
  isGmailServiceError,
  listGmailAddedMessageHistoryPage,
  listGmailMessageIds,
  listLabels,
  MAILBOX_LABELS,
  stopGmailWatch,
  updateMessageLabels,
  watchGmailMailbox,
} from "@quieter/gmail";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { syncGmailLabels } from "../gmail-labels";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import {
  listPendingGmailUsefulDetailMessageIds,
  processGmailUsefulDetailMessage,
  reportPendingGmailUsefulDetailUsage,
} from "../gmail-useful-details/service";

const WATCH_RENEWAL_INTERVAL_MS = 1000 * 60 * 60 * 20;
const WATCH_EXPIRATION_BUFFER_MS = 1000 * 60 * 60 * 48;
const PROCESSING_LEASE_MS = 1000 * 60 * 14;
const HISTORY_RECOVERY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 7;
const HISTORY_RECOVERY_OVERLAP_MS = 1000 * 60 * 60;
const AUTO_LABEL_RETRY_BASE_MS = 1000 * 60 * 5;
const AUTO_LABEL_RETRY_MAX_MS = 1000 * 60 * 60 * 24;
const AUTO_LABEL_EXCLUDED_LABELS = new Set<string>([
  MAILBOX_LABELS.drafts,
  MAILBOX_LABELS.sent,
  MAILBOX_LABELS.spam,
  MAILBOX_LABELS.trash,
]);

type AutoLabelContext = {
  availableLabelIds: Set<string>;
  labels: GmailAutoLabelCandidate[];
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 2_000) : "Unknown Gmail update error.";

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
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailWatchState.mailboxId, mailboxId),
        or(
          isNull(gmailWatchState.processingLeaseExpiresAt),
          lt(gmailWatchState.processingLeaseExpiresAt, now),
        ),
      ),
    )
    .returning({ mailboxId: gmailWatchState.mailboxId });

  return claimed ? leaseId : null;
};

const extendMailboxProcessingLease = async (mailboxId: string, leaseId: string) => {
  const now = new Date();
  await db
    .update(gmailWatchState)
    .set({
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(eq(gmailWatchState.mailboxId, mailboxId), eq(gmailWatchState.processingLeaseId, leaseId)),
    );
};

const releaseMailboxProcessingLease = async (mailboxId: string, leaseId: string) => {
  await db
    .update(gmailWatchState)
    .set({
      processingLeaseExpiresAt: null,
      processingLeaseId: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(gmailWatchState.mailboxId, mailboxId), eq(gmailWatchState.processingLeaseId, leaseId)),
    );
};

const reportAutoLabelUsage = async (event: {
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
    event.model !== GMAIL_AUTO_LABEL_MODEL ||
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
      model: GMAIL_AUTO_LABEL_MODEL,
      promptTokens: event.promptTokens,
      userId: event.userId,
    });
    await db
      .update(gmailAutoLabelEvent)
      .set({
        lastError: null,
        updatedAt: new Date(),
        usageReportedAt: new Date(),
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
  } catch (error) {
    await db
      .update(gmailAutoLabelEvent)
      .set({
        lastError: `AI usage reporting failed: ${getErrorMessage(error)}`,
        updatedAt: new Date(),
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
  }
};

const reportPendingAutoLabelUsage = async (mailboxId: string, userId: string) => {
  const events = await db
    .select({
      completionTokens: gmailAutoLabelEvent.completionTokens,
      id: gmailAutoLabelEvent.id,
      model: gmailAutoLabelEvent.model,
      promptTokens: gmailAutoLabelEvent.promptTokens,
      usageReportedAt: gmailAutoLabelEvent.usageReportedAt,
    })
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, mailboxId),
        eq(gmailAutoLabelEvent.model, GMAIL_AUTO_LABEL_MODEL),
        isNull(gmailAutoLabelEvent.usageReportedAt),
      ),
    )
    .limit(100);

  for (const event of events) {
    await reportAutoLabelUsage({ ...event, mailboxId, userId });
  }
};

const getOrCreateAutoLabelEvent = async (mailboxId: string, gmailMessageId: string) => {
  const now = new Date();
  await db
    .insert(gmailAutoLabelEvent)
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
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, mailboxId),
        eq(gmailAutoLabelEvent.gmailMessageId, gmailMessageId),
      ),
    )
    .limit(1);

  if (!event) {
    throw new Error("Could not create Gmail auto-label event.");
  }

  return event;
};

const isAutoLabelCandidate = (labelIds: string[] | undefined) =>
  !!labelIds?.includes(MAILBOX_LABELS.inbox) &&
  !labelIds.some((labelId) => AUTO_LABEL_EXCLUDED_LABELS.has(labelId));

const processAutoLabelMessage = async ({
  accessToken,
  autoLabelContext,
  gmailMessageId,
  loadMessage,
  mailboxId,
  userId,
}: {
  accessToken: string;
  autoLabelContext: AutoLabelContext;
  gmailMessageId: string;
  loadMessage: () => Promise<Awaited<ReturnType<typeof getMessageWithDetails>> | null>;
  mailboxId: string;
  userId: string;
}) => {
  let event = await getOrCreateAutoLabelEvent(mailboxId, gmailMessageId);

  if (event.appliedAt) {
    await reportAutoLabelUsage({ ...event, userId });
    return;
  }

  try {
    if (event.labelIds == null) {
      if (autoLabelContext.labels.length === 0) {
        const now = new Date();
        await db
          .update(gmailAutoLabelEvent)
          .set({
            appliedAt: now,
            labelIds: [],
            lastError: null,
            nextAttemptAt: null,
            updatedAt: now,
            usageReportedAt: now,
          })
          .where(eq(gmailAutoLabelEvent.id, event.id));
        return;
      }

      const message = await loadMessage();
      if (!message) {
        const now = new Date();
        await db
          .update(gmailAutoLabelEvent)
          .set({
            appliedAt: now,
            labelIds: [],
            lastError: null,
            nextAttemptAt: null,
            updatedAt: now,
            usageReportedAt: now,
          })
          .where(eq(gmailAutoLabelEvent.id, event.id));
        return;
      }

      if (!isAutoLabelCandidate(message.labelIds)) {
        const now = new Date();
        await db
          .update(gmailAutoLabelEvent)
          .set({
            appliedAt: now,
            labelIds: [],
            lastError: null,
            nextAttemptAt: null,
            updatedAt: now,
            usageReportedAt: now,
          })
          .where(eq(gmailAutoLabelEvent.id, event.id));
        return;
      }

      let promptTokens = 0;
      let completionTokens = 0;
      const usageMiddleware: ChatMiddleware = {
        name: "gmail-auto-label-usage",
        onUsage: (_context, usage) => {
          promptTokens += usage.promptTokens;
          completionTokens += usage.completionTokens;
        },
      };
      const labelIds = await classifyGmailMessage({
        labels: autoLabelContext.labels,
        message,
        middleware: [usageMiddleware],
      });
      const now = new Date();
      const [classified] = await db
        .update(gmailAutoLabelEvent)
        .set({
          completionTokens,
          labelIds,
          lastError: null,
          model: GMAIL_AUTO_LABEL_MODEL,
          promptTokens,
          updatedAt: now,
        })
        .where(eq(gmailAutoLabelEvent.id, event.id))
        .returning();
      event = classified ?? event;
    }

    const labelIds = (event.labelIds ?? []).filter((labelId) =>
      autoLabelContext.availableLabelIds.has(labelId),
    );

    if (labelIds.length > 0) {
      try {
        await updateMessageLabels(accessToken, gmailMessageId, { addLabelIds: labelIds });
      } catch (error) {
        if (!isGmailServiceError(error) || error.status !== 404) {
          throw error;
        }
      }
    }

    const now = new Date();
    await db
      .update(gmailAutoLabelEvent)
      .set({
        appliedAt: now,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    await reportAutoLabelUsage({ ...event, userId });
  } catch (error) {
    const now = new Date();
    const attemptCount = event.attemptCount + 1;
    await db
      .update(gmailAutoLabelEvent)
      .set({
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: new Date(
          now.getTime() +
            Math.min(AUTO_LABEL_RETRY_MAX_MS, AUTO_LABEL_RETRY_BASE_MS * 2 ** (attemptCount - 1)),
        ),
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    console.error(
      `Could not auto-label Gmail message ${gmailMessageId} for mailbox ${mailboxId}.`,
      getErrorMessage(error),
    );
  }
};

const processMessageIds = async ({
  accessToken,
  autoLabelEnabled,
  getAutoLabelContext,
  mailboxId,
  messageIds,
  usefulDetailsEnabled,
  userId,
}: {
  accessToken: string;
  autoLabelEnabled: boolean;
  getAutoLabelContext: () => Promise<AutoLabelContext>;
  mailboxId: string;
  messageIds: string[];
  usefulDetailsEnabled: boolean;
  userId: string;
}) => {
  if ((!autoLabelEnabled && !usefulDetailsEnabled) || messageIds.length === 0) {
    return;
  }

  const autoLabelContext = autoLabelEnabled ? await getAutoLabelContext() : null;

  for (const messageId of messageIds) {
    let messagePromise: ReturnType<typeof getMessageWithDetails> | null = null;
    const loadMessage = async () => {
      messagePromise ??= getMessageWithDetails(accessToken, messageId);
      try {
        return await messagePromise;
      } catch (error) {
        if (isGmailServiceError(error) && error.status === 404) {
          return null;
        }
        throw error;
      }
    };

    if (autoLabelContext) {
      await processAutoLabelMessage({
        accessToken,
        autoLabelContext,
        gmailMessageId: messageId,
        loadMessage,
        mailboxId,
        userId,
      });
    }
    if (usefulDetailsEnabled) {
      await processGmailUsefulDetailMessage({
        gmailMessageId: messageId,
        loadMessage,
        mailboxId,
        userId,
      });
    }
  }
};

const retryPendingAutomationMessages = async ({
  accessToken,
  autoLabelEnabled,
  getAutoLabelContext,
  mailboxId,
  usefulDetailsEnabled,
  userId,
}: {
  accessToken: string;
  autoLabelEnabled: boolean;
  getAutoLabelContext: () => Promise<AutoLabelContext>;
  mailboxId: string;
  usefulDetailsEnabled: boolean;
  userId: string;
}) => {
  if (!autoLabelEnabled && !usefulDetailsEnabled) {
    return;
  }

  const now = new Date();
  const [autoLabelEvents, usefulDetailMessageIds] = await Promise.all([
    autoLabelEnabled
      ? db
          .select({ gmailMessageId: gmailAutoLabelEvent.gmailMessageId })
          .from(gmailAutoLabelEvent)
          .where(
            and(
              eq(gmailAutoLabelEvent.mailboxId, mailboxId),
              isNull(gmailAutoLabelEvent.appliedAt),
              or(
                isNull(gmailAutoLabelEvent.nextAttemptAt),
                lte(gmailAutoLabelEvent.nextAttemptAt, now),
              ),
            ),
          )
          .limit(20)
      : Promise.resolve([]),
    usefulDetailsEnabled ? listPendingGmailUsefulDetailMessageIds(mailboxId) : Promise.resolve([]),
  ]);

  await processMessageIds({
    accessToken,
    autoLabelEnabled,
    getAutoLabelContext,
    mailboxId,
    messageIds: Array.from(
      new Set([...autoLabelEvents.map((event) => event.gmailMessageId), ...usefulDetailMessageIds]),
    ),
    usefulDetailsEnabled,
    userId,
  });
};

const beginHistoryRecovery = async (
  accessToken: string,
  mailboxId: string,
  lastProcessedAt: Date | null,
) => {
  const profile = await getGmailProfile(accessToken);
  if (!profile.historyId) {
    throw new Error("Gmail profile did not include a history ID.");
  }

  const now = new Date();
  const earliestRecovery = now.getTime() - HISTORY_RECOVERY_LOOKBACK_MS;
  const desiredRecovery =
    (lastProcessedAt?.getTime() ?? earliestRecovery) - HISTORY_RECOVERY_OVERLAP_MS;

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
  autoLabelEnabled,
  getAutoLabelContext,
  mailboxId,
  usefulDetailsEnabled,
  userId,
}: {
  accessToken: string;
  autoLabelEnabled: boolean;
  getAutoLabelContext: () => Promise<AutoLabelContext>;
  mailboxId: string;
  usefulDetailsEnabled: boolean;
  userId: string;
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

  if (!state?.recoveryAfter || !state.recoveryBefore) {
    return;
  }

  const page = await listGmailMessageIds(accessToken, {
    mailbox: "inbox",
    maxResults: 25,
    pageToken: state.recoveryPageToken ?? undefined,
    query: `after:${Math.floor(state.recoveryAfter.getTime() / 1000)} before:${Math.floor(
      state.recoveryBefore.getTime() / 1000,
    )}`,
  });
  await processMessageIds({
    accessToken,
    autoLabelEnabled,
    getAutoLabelContext,
    mailboxId,
    messageIds: page.messageIds,
    usefulDetailsEnabled,
    userId,
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
  userId,
}: {
  mailboxId: string;
  maxHistoryPages: number;
  userId: string;
}) => {
  const leaseId = await claimMailboxProcessingLease(mailboxId);
  if (!leaseId) {
    return { busy: true };
  }

  try {
    await runAuthorizedGmailMailbox({ mailboxId, userId }, async (accessToken) => {
      const [[autoLabelSettings], [usefulDetailsSettings]] = await Promise.all([
        db
          .select({ enabled: gmailAutoLabelSettings.enabled })
          .from(gmailAutoLabelSettings)
          .where(eq(gmailAutoLabelSettings.mailboxId, mailboxId))
          .limit(1),
        db
          .select({ enabled: gmailUsefulDetailSettings.enabled })
          .from(gmailUsefulDetailSettings)
          .where(eq(gmailUsefulDetailSettings.mailboxId, mailboxId))
          .limit(1),
      ]);
      const autoLabelEnabled = autoLabelSettings?.enabled ?? false;
      const usefulDetailsEnabled = usefulDetailsSettings?.enabled ?? false;
      let autoLabelContextPromise: Promise<AutoLabelContext> | null = null;
      const getAutoLabelContext = () => {
        autoLabelContextPromise ??= listLabels(accessToken)
          .then((labels) => syncGmailLabels(mailboxId, labels))
          .then((gmailLabels) => {
            const labels = gmailLabels
              .filter((label) => label.type === "user")
              .map((label) => ({
                description: label.description,
                id: label.id,
                inclusionCriteria: label.inclusionCriteria,
                name: label.name,
              }));

            return {
              availableLabelIds: new Set(labels.map((label) => label.id)),
              labels,
            };
          });

        return autoLabelContextPromise;
      };

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
          await beginHistoryRecovery(accessToken, mailboxId, state?.lastProcessedAt ?? null);
          break;
        }

        const page = await listGmailAddedMessageHistoryPage(accessToken, {
          pageToken: state.historyPageToken ?? undefined,
          startHistoryId: state.historyId,
        });
        if (page.historyExpired) {
          await beginHistoryRecovery(accessToken, mailboxId, state.lastProcessedAt);
          break;
        }

        await processMessageIds({
          accessToken,
          autoLabelEnabled,
          getAutoLabelContext,
          mailboxId,
          messageIds: page.messageIds,
          usefulDetailsEnabled,
          userId,
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
        autoLabelEnabled,
        getAutoLabelContext,
        mailboxId,
        usefulDetailsEnabled,
        userId,
      });
      await retryPendingAutomationMessages({
        accessToken,
        autoLabelEnabled,
        getAutoLabelContext,
        mailboxId,
        usefulDetailsEnabled,
        userId,
      });
      await Promise.all([
        reportPendingAutoLabelUsage(mailboxId, userId),
        reportPendingGmailUsefulDetailUsage(mailboxId, userId),
      ]);
      const now = new Date();
      await db
        .update(gmailWatchState)
        .set({
          lastError: null,
          lastErrorAt: null,
          lastReconciledAt: now,
          updatedAt: now,
        })
        .where(eq(gmailWatchState.mailboxId, mailboxId));
    });

    return { busy: false };
  } catch (error) {
    await recordWatchError(mailboxId, error);
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

  if (!state || !shouldRenewWatch(state)) {
    return;
  }

  const watch = await runAuthorizedGmailMailbox({ mailboxId, userId }, (accessToken) =>
    watchGmailMailbox(accessToken, topicName),
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

const disableMailboxWatch = async (mailboxId: string, userId: string) => {
  const [state] = await db
    .select({
      watchExpirationAt: gmailWatchState.watchExpirationAt,
      watchRenewedAt: gmailWatchState.watchRenewedAt,
    })
    .from(gmailWatchState)
    .where(eq(gmailWatchState.mailboxId, mailboxId))
    .limit(1);
  if (!state?.watchRenewedAt && !state?.watchExpirationAt) {
    return;
  }

  await runAuthorizedGmailMailbox({ mailboxId, userId }, (accessToken) =>
    stopGmailWatch(accessToken),
  );
  await db
    .update(gmailWatchState)
    .set({
      updatedAt: new Date(),
      watchExpirationAt: null,
      watchRenewedAt: null,
    })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
};

export const listGmailPubSubMaintenanceJobs = async () =>
  await db
    .select({
      emailAddress: mailbox.emailAddress,
      mailboxId: mailbox.id,
    })
    .from(mailbox)
    .where(eq(mailbox.provider, "gmail"));

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

    const entitlement = await hasUserBillingFeature({
      feature: "gmailAutomation",
      organizationId: gmailMailbox.organizationId ?? undefined,
      userId: gmailMailbox.ownerUserId,
    });
    if (!entitlement.hasAccess) {
      await disableMailboxWatch(gmailMailbox.id, gmailMailbox.ownerUserId);
      return { status: "ineligible" as const };
    }

    await renewMailboxWatch({
      mailboxId: gmailMailbox.id,
      topicName: input.topicName,
      userId: gmailMailbox.ownerUserId,
    });
    const result = await processMailboxHistory({
      mailboxId: gmailMailbox.id,
      maxHistoryPages: 2,
      userId: gmailMailbox.ownerUserId,
    });
    return { status: result.busy ? ("busy" as const) : ("maintained" as const) };
  } catch (error) {
    await recordWatchError(gmailMailbox.id, error);
    throw error;
  }
};

export const processGmailPubSubNotification = async (
  input: {
    emailAddress: string;
    historyId: string;
    pubSubMessageId: string;
  },
  options?: {
    onAccepted?: (input: { mailboxId: string }) => Promise<void>;
    onProcessed?: (input: { mailboxId: string }) => Promise<void>;
  },
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
        eq(mailbox.provider, "gmail"),
      ),
    )
    .limit(1);

  if (!gmailMailbox?.ownerUserId || gmailMailbox.status !== "connected") {
    return { ignored: true, reason: "mailbox_not_connected" as const };
  }

  await ensureWatchState(gmailMailbox.id);
  await db
    .update(gmailWatchState)
    .set({
      lastNotificationAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(gmailWatchState.mailboxId, gmailMailbox.id));

  const entitlement = await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: gmailMailbox.organizationId ?? undefined,
    userId: gmailMailbox.ownerUserId,
  });
  if (!entitlement.hasAccess) {
    return { ignored: true, reason: "plan_ineligible" as const };
  }

  await options?.onAccepted?.({ mailboxId: gmailMailbox.id });

  const result = await processMailboxHistory({
    mailboxId: gmailMailbox.id,
    maxHistoryPages: 5,
    userId: gmailMailbox.ownerUserId,
  });
  if (!result.busy) {
    await options?.onProcessed?.({ mailboxId: gmailMailbox.id });
  }

  return {
    busy: result.busy,
    ignored: false,
    mailboxId: gmailMailbox.id,
    pubSubMessageId: input.pubSubMessageId,
  };
};
