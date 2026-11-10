import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { classifyMailMessage } from "@quieter/ai/classify-gmail-message";
import type { MailAutoLabelCandidate } from "@quieter/ai/classify-gmail-message";
import {
  isAiCreditAdmissionBusy,
  shouldReportAiTaskFailure,
} from "@quieter/ai/errors";
import { AI_CREDIT_ADMISSION_BUSY_MESSAGE } from "@quieter/billing/ai-credit-errors";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import { gmailAutoLabelEvent } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import {
  getMessageWithDetails,
  isGmailServiceError,
  isGmailRateLimitedError,
  mutateGmailMessage,
} from "@quieter/gmail";
import type { GmailServiceError } from "@quieter/gmail";
import { partitionAutoLabelCandidates } from "@quieter/mail/auto-label-matching";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import { and, eq } from "drizzle-orm";

import {
  buildMailMemoryQuery,
  loadAiAgentContext,
  serializeAiAgentContext,
} from "../ai-memory";
import type { AiAgentMemoryCandidates } from "../ai-memory";
import { captureMailboxMessageMemory } from "../ai-memory-capture";
import { enqueueMailAgentMessage } from "../mail-agent/inbox";
import type { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import {
  AUTO_LABEL_BUDGET_RETRY_MS,
  deferAutoLabelAutomation,
} from "../mail-automation/auto-label-events";
import { loadMailAutoLabelHistory } from "../mail-automation/history";
import { reportAutoLabelUsage } from "../mail-automation/usage";
import { writeGmailCapturedMessage } from "../mail-capture";
import { observeReminderMail } from "../reminders/service";
import {
  processMailVerificationCode,
  AI_ADMISSION_RETRY_MS,
} from "../verification-codes";

const AUTO_LABEL_RETRY_BASE_MS = 1000 * 60 * 5;
const AUTO_LABEL_RETRY_MAX_MS = 1000 * 60 * 60 * 24;
const MAILBOX_RATE_LIMIT_RETRY_MS = 60_000;
const AUTO_LABEL_EXCLUDED_LABELS = new Set<string>([
  MAILBOX_LABELS.drafts,
  MAILBOX_LABELS.sent,
  MAILBOX_LABELS.spam,
  MAILBOX_LABELS.trash,
]);

export type AutoLabelContext = {
  availableLabelIds: Set<string>;
  historyLabels: Pick<MailAutoLabelCandidate, "id" | "name">[];
  labels: MailAutoLabelCandidate[];
  memoryCandidates: AiAgentMemoryCandidates | null;
  model: string;
};
type MailAutomationBudgetStatus = Awaited<
  ReturnType<typeof getMailAutomationAiBudgetStatus>
>;
export type MailAutomationRuntime = {
  getAutoLabelContext: () => Promise<AutoLabelContext>;
  getBudgetStatus: () => Promise<MailAutomationBudgetStatus>;
};
export type AutoLabelProcessingResult =
  | { status: "complete" }
  | {
      status: "retry";
      reason: "admission_busy" | "budget" | "failure";
      retryAt: Date;
    };

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 2000)
    : "Unknown Gmail update error.";

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
}): Promise<AutoLabelProcessingResult> => {
  let event = await getOrCreateAutoLabelEvent(mailboxId, gmailMessageId);

  if (event.appliedAt) {
    await reportAutoLabelUsage({ ...event, userId });
    return { status: "complete" };
  }

  try {
    let budgetStatus: MailAutomationBudgetStatus | undefined;
    if (event.nextAttemptAt && event.nextAttemptAt.getTime() > Date.now()) {
      let reason: "admission_busy" | "budget" | "failure" = "failure";
      if (event.lastError === AI_CREDIT_ADMISSION_BUSY_MESSAGE) {
        reason = "admission_busy";
      } else if (
        event.attemptCount === 0 &&
        event.labelIds === null &&
        event.lastError !== null
      ) {
        reason = "budget";
      }
      if (reason !== "budget") {
        return { reason, retryAt: event.nextAttemptAt, status: "retry" };
      }
      budgetStatus = await getBudgetStatus();
      if (!budgetStatus.allowed) {
        return { reason, retryAt: event.nextAttemptAt, status: "retry" };
      }
    }
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
        return { status: "complete" };
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
        return { status: "complete" };
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
        return { status: "complete" };
      }

      let usage: AiUsageReport = {
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        costUsd: undefined,
        promptTokens: 0,
      };
      const { aiLabels, deterministicLabelIds } = partitionAutoLabelCandidates(
        autoLabelContext.labels,
        message
      );
      if (aiLabels.length > 0) {
        budgetStatus ??= await getBudgetStatus();
        if (!budgetStatus.allowed) {
          if (
            deterministicLabelIds.length > 0 &&
            (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local" ||
              serverEnv.QUIETER_LOCAL_PROVIDER_MODE === "write")
          ) {
            await mutateGmailMessage(accessToken, gmailMessageId, {
              addLabelIds: deterministicLabelIds,
            });
          }
          await deferAutoLabelAutomation(event.id, budgetStatus.message);
          return {
            reason: "budget",
            retryAt: new Date(Date.now() + AUTO_LABEL_BUDGET_RETRY_MS),
            status: "retry",
          };
        }
      }

      const labelHistory =
        aiLabels.length === 0
          ? null
          : await loadMailAutoLabelHistory({
              accessToken,
              labels: autoLabelContext.historyLabels,
              mailboxId,
              message,
              provider: "gmail",
              userId,
            });
      const memoryContext =
        aiLabels.length === 0 || autoLabelContext.memoryCandidates === null
          ? null
          : await loadAiAgentContext({
              agent: "auto_label",
              candidates: autoLabelContext.memoryCandidates,
              mailboxId,
              query: buildMailMemoryQuery(message),
              semantic: { billingMailboxId: mailboxId },
              userId: autoLabelContext.memoryCandidates.userId,
            });
      const aiLabelIds =
        aiLabels.length === 0
          ? []
          : await classifyMailMessage({
              billing: await createMailboxAiBillingContext({
                externalId: event.id,
                mailboxId,
                usageKind: "autoLabel",
                userId,
              }),
              labelHistory,
              labels: aiLabels,
              memoryContext:
                memoryContext === null
                  ? null
                  : serializeAiAgentContext(memoryContext),
              message,
              model: autoLabelContext.model,
              onUsage: (reportedUsage) => {
                usage = reportedUsage;
              },
            });
      const labelIds = [...new Set([...deterministicLabelIds, ...aiLabelIds])];
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
          model: aiLabels.length > 0 ? autoLabelContext.model : null,
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

    if (
      serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
      serverEnv.QUIETER_LOCAL_PROVIDER_MODE !== "write"
    ) {
      await db
        .update(gmailAutoLabelEvent)
        .set({
          lastError:
            "Development observation: classification saved; mailbox unchanged.",
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(eq(gmailAutoLabelEvent.id, event.id));
      await reportAutoLabelUsage({ ...event, userId });
      return { status: "complete" };
    }

    if (labelIds.length > 0) {
      try {
        await mutateGmailMessage(accessToken, gmailMessageId, {
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
    return { status: "complete" };
  } catch (error) {
    if (isAiCreditAdmissionBusy(error)) {
      const now = new Date();
      const retryAt = new Date(now.getTime() + AI_ADMISSION_RETRY_MS);
      await db
        .update(gmailAutoLabelEvent)
        .set({
          lastError: AI_CREDIT_ADMISSION_BUSY_MESSAGE,
          nextAttemptAt: retryAt,
          updatedAt: now,
        })
        .where(eq(gmailAutoLabelEvent.id, event.id));
      return { reason: "admission_busy", retryAt, status: "retry" };
    }
    const now = new Date();
    const attemptCount = event.attemptCount + 1;
    const retryAt = new Date(
      now.getTime() +
        Math.max(
          Math.min(
            AUTO_LABEL_RETRY_MAX_MS,
            AUTO_LABEL_RETRY_BASE_MS * 2 ** (attemptCount - 1)
          ),
          isGmailRateLimitedError(error) ? (error.retryAfterMs ?? 0) : 0
        )
    );
    await db
      .update(gmailAutoLabelEvent)
      .set({
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: retryAt,
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    if (isGmailRateLimitedError(error)) {
      throw error;
    }
    if (shouldReportAiTaskFailure(error, attemptCount)) {
      reportError(error, { operation: "gmail-sync:auto-label-message" });
    }
    return { reason: "failure", retryAt, status: "retry" };
  }
};

export type GmailMessageCriticalTimings = {
  autoLabelMs: number;
  totalMs: number;
  verificationCodeMs: number;
};

export const processGmailMessage = async ({
  accessToken,
  automationRuntime,
  autoLabelEnabled,
  extractCodes,
  gmailMessageId,
  mailboxId,
  onCriticalComplete,
  organizationId,
  triggerActions = false,
  userId,
}: {
  accessToken: string;
  automationRuntime: MailAutomationRuntime;
  autoLabelEnabled: boolean;
  extractCodes: boolean;
  gmailMessageId: string;
  mailboxId: string;
  onCriticalComplete?: (
    timings: GmailMessageCriticalTimings
  ) => void | Promise<void>;
  organizationId: string | null;
  triggerActions?: boolean;
  userId: string;
}) => {
  let messagePromise: ReturnType<typeof getMessageWithDetails> | null = null;
  let capturedSnapshot: CapturedMailSnapshot | undefined;
  const loadMessage = async () => {
    messagePromise ??= getMessageWithDetails(
      accessToken,
      gmailMessageId,
      undefined,
      (snapshot) => {
        capturedSnapshot = snapshot;
      }
    );
    try {
      return await messagePromise;
    } catch (error) {
      if (isGmailServiceError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  const startedAt = performance.now();
  let verificationCodeMs = 0;
  let autoLabelMs = 0;
  const [verificationCode, autoLabel] = await Promise.allSettled([
    (extractCodes
      ? processMailVerificationCode({
          loadMessage,
          mailboxId,
          messageId: gmailMessageId,
          organizationId,
          userId,
        })
      : Promise.resolve({ status: "disabled" } as const)
    ).finally(() => {
      verificationCodeMs = performance.now() - startedAt;
    }),
    (autoLabelEnabled
      ? processAutoLabelMessage({
          accessToken,
          getAutoLabelContext: automationRuntime.getAutoLabelContext,
          getBudgetStatus: automationRuntime.getBudgetStatus,
          gmailMessageId,
          loadMessage,
          mailboxId,
          userId,
        })
      : Promise.resolve({ status: "disabled" } as const)
    ).finally(() => {
      autoLabelMs = performance.now() - startedAt;
    }),
  ]);
  const labelFinishedAt = performance.now();
  if (
    verificationCode.status === "fulfilled" &&
    verificationCode.value.status !== "retry" &&
    autoLabel.status === "fulfilled" &&
    autoLabel.value.status !== "retry"
  ) {
    await onCriticalComplete?.({
      autoLabelMs,
      totalMs: labelFinishedAt - startedAt,
      verificationCodeMs,
    });
  }

  const followUpOutcomes = await Promise.allSettled([
    loadMessage().then(async () => {
      if (capturedSnapshot !== undefined) {
        await writeGmailCapturedMessage({
          mailboxId,
          snapshot: capturedSnapshot,
          source: "history",
        });
      }
    }),
    loadMessage().then(async (message) => {
      if (message) {
        await captureMailboxMessageMemory({
          actorUserId: userId,
          mailboxId,
          message,
          source: "sync",
        });
      }
    }),
    triggerActions
      ? loadMessage().then(async (message) => {
          if (
            message !== null &&
            !message.draftId &&
            message.labelIds?.some((label) =>
              AUTO_LABEL_EXCLUDED_LABELS.has(label)
            ) !== true
          ) {
            const receivedAt = Number(message.internalDate);
            if (!Number.isFinite(receivedAt) || receivedAt <= 0) {
              throw new Error("Gmail message is missing its arrival time.");
            }
            await enqueueMailAgentMessage({
              mailboxId,
              messageId: message.id,
              receivedAt: new Date(receivedAt),
              threadId: message.threadId,
            });
            await observeReminderMail({
              mailboxId,
              messageId: message.id,
              receivedAt: new Date(receivedAt),
              threadId: message.threadId,
            });
          }
        })
      : undefined,
  ]);
  const failures = new Set<unknown>();
  let throttled: GmailServiceError | undefined;
  for (const outcome of [verificationCode, autoLabel, ...followUpOutcomes]) {
    if (outcome?.status === "rejected") {
      const error: unknown = outcome.reason;
      failures.add(error);
      if (
        isGmailRateLimitedError(error) &&
        (throttled === undefined ||
          (error.retryAfterMs ?? MAILBOX_RATE_LIMIT_RETRY_MS) >
            (throttled.retryAfterMs ?? MAILBOX_RATE_LIMIT_RETRY_MS))
      ) {
        throttled = error;
      }
    }
  }
  if (throttled !== undefined) {
    for (const failure of failures) {
      if (
        !isGmailRateLimitedError(failure) &&
        !isAiCreditAdmissionBusy(failure) &&
        !(failure instanceof ORPCError && failure.status < 500)
      ) {
        reportError(failure, { operation: "gmail-sync:message-work" });
      }
    }
    throw throttled;
  }
  if (failures.size > 0) {
    const [failure] = failures;
    throw failure;
  }
  return {
    autoLabel: autoLabel?.status === "fulfilled" ? autoLabel.value : null,
    verificationCode:
      verificationCode?.status === "fulfilled" ? verificationCode.value : null,
  };
};
