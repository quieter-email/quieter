import { randomUUID } from "node:crypto";

import { chatModelSchema } from "@quieter/ai/chat-models";
import type { ChatModel } from "@quieter/ai/chat-models";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { classifyMailMessage } from "@quieter/ai/classify-gmail-message";
import type { MailAutoLabelCandidate } from "@quieter/ai/classify-gmail-message";
import { reportAiUsage } from "@quieter/billing";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  gmailAutoLabelEvent,
  gmailUsefulDetailSettings,
  gmailWatchState,
  mailboxAction,
  mailboxAutomationSettings,
  mailbox,
} from "@quieter/database/schema";
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
import { reportError } from "@quieter/observability";
import {
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

import {
  buildMailMemoryQuery,
  loadAiAgentMemoryCandidates,
  loadAiConfiguration,
  loadAiAgentContext,
  serializeAiAgentContext,
} from "../ai-memory";
import type { AiAgentMemoryCandidates } from "../ai-memory";
import { syncGmailLabels } from "../gmail-labels";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import {
  listPendingGmailUsefulDetailMessageIds,
  processGmailUsefulDetailMessage,
  reportPendingGmailUsefulDetailUsage,
} from "../gmail-useful-details/service";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { deferAutoLabelAutomation } from "../mail-automation/auto-label-events";
import { enqueueMailboxActionsForMessage } from "../mailbox-actions/enqueue";

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

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

type AutoLabelContext = {
  availableLabelIds: Set<string>;
  labels: MailAutoLabelCandidate[];
  memoryCandidates: AiAgentMemoryCandidates;
  model: ChatModel;
};
type MailAutomationBudgetStatus = Awaited<
  ReturnType<typeof getMailAutomationAiBudgetStatus>
>;
type MailAutomationContext = {
  configuration: Awaited<ReturnType<typeof loadAiConfiguration>>;
  memoryCandidates: AiAgentMemoryCandidates;
};
type MailAutomationRuntime = {
  getAutoLabelContext: () => Promise<AutoLabelContext>;
  getBudgetStatus: () => Promise<MailAutomationBudgetStatus>;
  getUsefulDetailAutomationContext: () => Promise<{
    memoryCandidates: AiAgentMemoryCandidates;
    model: ChatModel;
  }>;
};

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

type OnRunsEnqueued = (runIds: string[]) => Promise<void> | void;

const enqueueMailboxActionRuns = async (input: {
  mailboxId: string;
  messageIds: string[];
  onRunsEnqueued?: OnRunsEnqueued;
}) => {
  if (input.messageIds.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    input.messageIds.map(
      async (messageId) =>
        await enqueueMailboxActionsForMessage({
          mailboxId: input.mailboxId,
          sourceMessageId: messageId,
        })
    )
  );
  const runIds: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      reportError(result.reason, {
        operation: "gmail-sync:enqueue-mailbox-action",
      });
      continue;
    }
    runIds.push(...result.value.enqueuedRunIds);
  }
  await input.onRunsEnqueued?.(runIds);
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
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gmailWatchState.mailboxId, mailboxId),
        eq(gmailWatchState.processingLeaseId, leaseId)
      )
    );
};

const reportAutoLabelUsage = async (event: {
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
      usageKind: "autoLabel",
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

const getOrCreateAutoLabelEvent = async (
  mailboxId: string,
  gmailMessageId: string
) => {
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
        eq(gmailAutoLabelEvent.gmailMessageId, gmailMessageId)
      )
    )
    .limit(1);

  if (event === undefined) {
    throw new Error("Could not create Gmail auto-label event.");
  }

  return event;
};

const isAutoLabelCandidate = (labelIds: string[] | undefined) =>
  labelIds?.includes(MAILBOX_LABELS.inbox) === true &&
  !labelIds.some((labelId) => AUTO_LABEL_EXCLUDED_LABELS.has(labelId));

const processAutoLabelMessage = async ({
  accessToken,
  getAutoLabelContext,
  getBudgetStatus,
  gmailMessageId,
  loadMessage,
  mailboxId,
  userId,
}: {
  accessToken: string;
  getAutoLabelContext: () => Promise<AutoLabelContext>;
  getBudgetStatus: () => Promise<MailAutomationBudgetStatus>;
  gmailMessageId: string;
  loadMessage: () => Promise<Awaited<
    ReturnType<typeof getMessageWithDetails>
  > | null>;
  mailboxId: string;
  userId: string;
}) => {
  let event = await getOrCreateAutoLabelEvent(mailboxId, gmailMessageId);

  if (event.appliedAt) {
    await reportAutoLabelUsage({ ...event, userId });
    return;
  }

  try {
    const autoLabelContext = await getAutoLabelContext();
    if (event.labelIds === null || event.labelIds === undefined) {
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

      let usage: AiUsageReport = {
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        costUsd: undefined,
        promptTokens: 0,
      };
      const budgetStatus = await getBudgetStatus();
      if (!budgetStatus.allowed) {
        await deferAutoLabelAutomation(event.id, budgetStatus.message);
        return;
      }

      const labelIds = await classifyMailMessage({
        labels: autoLabelContext.labels,
        memoryContext: serializeAiAgentContext(
          await loadAiAgentContext({
            agent: "auto_label",
            candidates: autoLabelContext.memoryCandidates,
            includeUserScope: false,
            mailboxId,
            query: buildMailMemoryQuery(message),
            semantic: false,
            userId,
          })
        ),
        message,
        model: autoLabelContext.model,
        onUsage: (reportedUsage) => {
          usage = reportedUsage;
        },
      });
      const now = new Date();
      const [classified] = await db
        .update(gmailAutoLabelEvent)
        .set({
          cacheWriteTokens: usage.cacheWriteTokens,
          cachedTokens: usage.cachedTokens,
          completionTokens: usage.completionTokens,
          costUsd: usage.costUsd,
          labelIds,
          lastError: null,
          model: autoLabelContext.model,
          promptTokens: usage.promptTokens,
          updatedAt: now,
          // Unreportable usage is terminal; only retryable reporting failures
          // keep usageReportedAt unset.
          usageReportedAt: usage.costUsd === undefined ? now : null,
        })
        .where(eq(gmailAutoLabelEvent.id, event.id))
        .returning();
      event = classified ?? event;
    }

    const labelIds = (event.labelIds ?? []).filter((labelId) =>
      autoLabelContext.availableLabelIds.has(labelId)
    );

    if (labelIds.length > 0) {
      try {
        await updateMessageLabels(accessToken, gmailMessageId, {
          addLabelIds: labelIds,
        });
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
            Math.min(
              AUTO_LABEL_RETRY_MAX_MS,
              AUTO_LABEL_RETRY_BASE_MS * 2 ** (attemptCount - 1)
            )
        ),
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    reportError(error, { operation: "gmail-sync:auto-label-message" });
  }
};

const processMessageIds = async ({
  accessToken,
  automationRuntime,
  autoLabelEnabled,
  mailboxId,
  messageIds,
  organizationId,
  usefulDetailsEnabled,
  userId,
}: {
  accessToken: string;
  automationRuntime: MailAutomationRuntime;
  autoLabelEnabled: boolean;
  mailboxId: string;
  messageIds: string[];
  organizationId: string | null;
  usefulDetailsEnabled: boolean;
  userId: string;
}) => {
  if ((!autoLabelEnabled && !usefulDetailsEnabled) || messageIds.length === 0) {
    return;
  }

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

    await Promise.all([
      autoLabelEnabled
        ? processAutoLabelMessage({
            accessToken,
            getAutoLabelContext: automationRuntime.getAutoLabelContext,
            getBudgetStatus: automationRuntime.getBudgetStatus,
            gmailMessageId: messageId,
            loadMessage,
            mailboxId,
            userId,
          })
        : Promise.resolve(),
      usefulDetailsEnabled
        ? processGmailUsefulDetailMessage({
            getAutomationContext:
              automationRuntime.getUsefulDetailAutomationContext,
            getBudgetStatus: automationRuntime.getBudgetStatus,
            gmailMessageId: messageId,
            loadMessage,
            mailboxId,
            organizationId,
            userId,
          })
        : Promise.resolve(),
    ]);
  }
};

const retryPendingAutomationMessages = async ({
  accessToken,
  automationRuntime,
  autoLabelEnabled,
  mailboxId,
  organizationId,
  usefulDetailsEnabled,
  userId,
}: {
  accessToken: string;
  automationRuntime: MailAutomationRuntime;
  autoLabelEnabled: boolean;
  mailboxId: string;
  organizationId: string | null;
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
                lte(gmailAutoLabelEvent.nextAttemptAt, now)
              )
            )
          )
          .limit(20)
      : Promise.resolve([]),
    usefulDetailsEnabled
      ? listPendingGmailUsefulDetailMessageIds(mailboxId)
      : Promise.resolve([]),
  ]);

  await processMessageIds({
    accessToken,
    autoLabelEnabled,
    automationRuntime,
    mailboxId,
    messageIds: [
      ...new Set([
        ...autoLabelEvents.map((event) => event.gmailMessageId),
        ...usefulDetailMessageIds,
      ]),
    ],
    organizationId,
    usefulDetailsEnabled,
    userId,
  });
};

const beginHistoryRecovery = async (
  accessToken: string,
  mailboxId: string,
  lastProcessedAt: Date | null
) => {
  const profile = await getGmailProfile(accessToken);
  if (!hasText(profile.historyId)) {
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
  automationRuntime,
  autoLabelEnabled,
  mailboxId,
  onRunsEnqueued,
  organizationId,
  usefulDetailsEnabled,
  userId,
}: {
  accessToken: string;
  automationRuntime: MailAutomationRuntime;
  autoLabelEnabled: boolean;
  mailboxId: string;
  onRunsEnqueued?: OnRunsEnqueued;
  organizationId: string | null;
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
    mailbox: "inbox",
    maxResults: 25,
    pageToken: state.recoveryPageToken ?? undefined,
    query: `after:${Math.floor(state.recoveryAfter.getTime() / 1000)} before:${Math.floor(
      state.recoveryBefore.getTime() / 1000
    )}`,
  });
  await processMessageIds({
    accessToken,
    autoLabelEnabled,
    automationRuntime,
    mailboxId,
    messageIds: page.messageIds,
    organizationId,
    usefulDetailsEnabled,
    userId,
  });
  await enqueueMailboxActionRuns({
    mailboxId,
    messageIds: page.messageIds,
    onRunsEnqueued,
  });

  await db
    .update(gmailWatchState)
    .set({
      recoveryAfter: hasText(page.nextPageToken) ? state.recoveryAfter : null,
      recoveryBefore: hasText(page.nextPageToken) ? state.recoveryBefore : null,
      recoveryPageToken: page.nextPageToken ?? null,
      updatedAt: new Date(),
    })
    .where(eq(gmailWatchState.mailboxId, mailboxId));
};

const processMailboxHistory = async ({
  mailboxId,
  maxHistoryPages,
  onRunsEnqueued,
  organizationId,
  userId,
}: {
  mailboxId: string;
  maxHistoryPages: number;
  onRunsEnqueued?: OnRunsEnqueued;
  organizationId: string | null;
  userId: string;
}) => {
  const leaseId = await claimMailboxProcessingLease(mailboxId);
  if (!hasText(leaseId)) {
    return { busy: true };
  }

  try {
    await runAuthorizedGmailMailbox(
      { mailboxId, userId },
      async (accessToken) => {
        const [[automationSettings], [usefulDetailsSettings]] =
          await Promise.all([
            db
              .select({
                autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
                usefulDetailsEnabled:
                  mailboxAutomationSettings.usefulDetailsEnabled,
              })
              .from(mailboxAutomationSettings)
              .where(eq(mailboxAutomationSettings.mailboxId, mailboxId))
              .limit(1),
            db
              .select({ enabled: gmailUsefulDetailSettings.enabled })
              .from(gmailUsefulDetailSettings)
              .where(eq(gmailUsefulDetailSettings.mailboxId, mailboxId))
              .limit(1),
          ]);
        const autoLabelEnabled = automationSettings?.autoLabelEnabled ?? false;
        const usefulDetailsEnabled =
          automationSettings?.usefulDetailsEnabled ??
          usefulDetailsSettings?.enabled ??
          false;
        let mailAutomationContextPromise: Promise<MailAutomationContext> | null =
          null;
        const getMailAutomationContext = async () => {
          mailAutomationContextPromise ??= Promise.all([
            loadAiConfiguration({ userId }),
            loadAiAgentMemoryCandidates({
              includeUserScope: false,
              mailboxId,
              userId,
            }),
          ]).then(([configuration, memoryCandidates]) => ({
            configuration,
            memoryCandidates,
          }));
          return await mailAutomationContextPromise;
        };
        let autoLabelContextPromise: Promise<AutoLabelContext> | null = null;
        const getAutoLabelContext = async () => {
          autoLabelContextPromise ??= Promise.all([
            listLabels(accessToken).then(
              async (labels) => await syncGmailLabels(mailboxId, labels)
            ),
            getMailAutomationContext(),
          ]).then(([gmailLabels, automationContext]) => {
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
              memoryCandidates: automationContext.memoryCandidates,
              model: automationContext.configuration.autoLabelModel,
            };
          });

          return await autoLabelContextPromise;
        };
        const getBudgetStatus = async () =>
          await getMailAutomationAiBudgetStatus({
            organizationId,
            userId,
          });
        const automationRuntime: MailAutomationRuntime = {
          getAutoLabelContext,
          getBudgetStatus,
          getUsefulDetailAutomationContext: async () => {
            const automationContext = await getMailAutomationContext();
            return {
              memoryCandidates: automationContext.memoryCandidates,
              model: automationContext.configuration.usefulDetailModel,
            };
          },
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
          if (!hasText(state?.historyId)) {
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

          await processMessageIds({
            accessToken,
            autoLabelEnabled,
            automationRuntime,
            mailboxId,
            messageIds: page.messageIds,
            organizationId,
            usefulDetailsEnabled,
            userId,
          });
          await enqueueMailboxActionRuns({
            mailboxId,
            messageIds: page.messageIds,
            onRunsEnqueued,
          });
          const now = new Date();
          await db
            .update(gmailWatchState)
            .set({
              historyId: hasText(page.nextPageToken)
                ? state.historyId
                : page.historyId,
              historyPageToken: page.nextPageToken ?? null,
              lastError: null,
              lastErrorAt: null,
              lastProcessedAt: now,
              updatedAt: now,
            })
            .where(eq(gmailWatchState.mailboxId, mailboxId));
          await extendMailboxProcessingLease(mailboxId, leaseId);

          if (!hasText(page.nextPageToken)) {
            break;
          }
        }

        await processHistoryRecoveryPage({
          accessToken,
          autoLabelEnabled,
          automationRuntime,
          mailboxId,
          onRunsEnqueued,
          organizationId,
          usefulDetailsEnabled,
          userId,
        });
        await retryPendingAutomationMessages({
          accessToken,
          autoLabelEnabled,
          automationRuntime,
          mailboxId,
          organizationId,
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
      }
    );

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

  await runAuthorizedGmailMailbox(
    { mailboxId, userId },
    async (accessToken) => {
      await stopGmailWatch(accessToken);
    }
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

// Maintenance selection is due-driven: watch renewal is the only job every
// connected mailbox needs on a schedule, while missed-notification
// reconciliation only matters for mailboxes with enabled automations, because
// users sync when they open the app and pushes keep active mailboxes fresh.
// Deterministic per-mailbox jitter spreads renewals and probes across their
// windows so they do not cluster on one tick.
const MAINTENANCE_JITTER_RANGE_SECONDS = 2 * 60 * 60;

const mailboxJitterSeconds = (column: AnyColumn) =>
  sql`((('x' || md5(${column}))::bit(32)::int & 2147483647) % ${MAINTENANCE_JITTER_RANGE_SECONDS})`;

export const listGmailPubSubMaintenanceJobs = async (limit = 500) =>
  await db
    .select({
      emailAddress: mailbox.emailAddress,
      mailboxId: mailbox.id,
    })
    .from(mailbox)
    .leftJoin(gmailWatchState, eq(gmailWatchState.mailboxId, mailbox.id))
    .where(
      and(
        eq(mailbox.provider, "gmail"),
        eq(mailbox.status, "connected"),
        or(
          isNull(gmailWatchState.mailboxId),
          isNull(gmailWatchState.watchExpirationAt),
          lte(
            gmailWatchState.watchExpirationAt,
            sql`now() + interval '72 hours'`
          ),
          lte(
            gmailWatchState.watchRenewedAt,
            sql`now() - interval '36 hours' - make_interval(secs => ${mailboxJitterSeconds(mailbox.id)})`
          ),
          and(
            exists(
              db
                .select({ one: sql`1` })
                .from(mailboxAction)
                .where(
                  and(
                    eq(mailboxAction.mailboxId, mailbox.id),
                    eq(mailboxAction.enabled, true),
                    eq(mailboxAction.status, "ready"),
                    isNotNull(mailboxAction.publishedRevisionId)
                  )
                )
            ),
            or(
              isNull(gmailWatchState.lastReconciledAt),
              lte(
                gmailWatchState.lastReconciledAt,
                sql`now() - interval '2 hours' - make_interval(secs => ${mailboxJitterSeconds(mailbox.id)})`
              )
            )
          )
        ),
        or(
          isNull(gmailWatchState.lastErrorAt),
          lte(gmailWatchState.lastErrorAt, sql`now() - interval '1 hour'`)
        )
      )
    )
    .orderBy(sql`coalesce(${gmailWatchState.watchExpirationAt}, '-infinity')`)
    .limit(limit);

export const maintainGmailPubSubMailbox = async (
  input: {
    mailboxId: string;
    topicName: string;
  },
  options?: { onRunsEnqueued?: OnRunsEnqueued }
) => {
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

  if (!hasText(gmailMailbox?.ownerUserId)) {
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
      onRunsEnqueued: options?.onRunsEnqueued,
      organizationId: gmailMailbox.organizationId,
      userId: gmailMailbox.ownerUserId,
    });
    return {
      status: result.busy ? ("busy" as const) : ("maintained" as const),
    };
  } catch (error) {
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
    onAccepted?: (input: { mailboxId: string }) => Promise<void>;
    onProcessed?: (input: { mailboxId: string }) => Promise<void>;
    onRunsEnqueued?: OnRunsEnqueued;
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

  if (
    !hasText(gmailMailbox?.ownerUserId) ||
    gmailMailbox.status !== "connected"
  ) {
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
    onRunsEnqueued: options?.onRunsEnqueued,
    organizationId: gmailMailbox.organizationId,
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
