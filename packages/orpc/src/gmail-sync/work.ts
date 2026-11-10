import { db } from "@quieter/database/client";
import { mailbox, mailboxAutomationSettings } from "@quieter/database/schema";
import {
  listGmailMessageIds,
  listLabels,
  isGmailRateLimitedError,
} from "@quieter/gmail";
import { and, eq } from "drizzle-orm";

import { loadAiAgentMemoryCandidates, loadAiConfiguration } from "../ai-memory";
import { getMailboxMemoryActor } from "../ai-memory-capture";
import { syncGmailLabels } from "../gmail-labels";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { processGmailMessage } from "./message";
import type {
  AutoLabelContext,
  GmailMessageCriticalTimings,
  MailAutomationRuntime,
} from "./message";
import type { GmailPubSubNotificationMessage } from "./service";
import {
  claimGmailMessageWork,
  deferGmailMailboxProvider,
  enqueueGmailMessageWork,
  finishGmailMessageWork,
  getGmailMessageWorkWake,
  getGmailMailboxProviderRetryAt,
} from "./work-store";
import type { GmailWorkPriority } from "./work-store";

export {
  enqueueGmailMessageWork,
  hasPendingFreshGmailWorkForAccount,
  listGmailMessageWorkWakeJobs,
} from "./work-store";
export { isGmailRateLimitedError } from "@quieter/gmail";

export const createGmailAutomationRuntime = (input: {
  accessToken: string;
  mailboxId: string;
  organizationId: string | null;
  userId: string;
}): MailAutomationRuntime => {
  let context: Promise<AutoLabelContext> | undefined;
  return {
    getAutoLabelContext: async () => {
      context ??= (async () => {
        const actor = await getMailboxMemoryActor({
          mailboxId: input.mailboxId,
        });
        const labels = await syncGmailLabels(
          input.mailboxId,
          await listLabels(input.accessToken)
        );
        const candidates = labels
          .filter(
            (label) =>
              label.type === "user" && label.autoLabel?.enabled !== false
          )
          .map((label) => ({
            autoLabel: label.autoLabel,
            description: label.description,
            id: label.id,
            inclusionCriteria: label.inclusionCriteria,
            name: label.name,
          }));
        return {
          availableLabelIds: new Set(candidates.map((label) => label.id)),
          historyLabels: labels
            .filter((label) => label.type === "user")
            .map(({ id, name }) => ({ id, name })),
          labels: candidates,
          memoryCandidates:
            actor === null
              ? null
              : await loadAiAgentMemoryCandidates({
                  mailboxId: input.mailboxId,
                  userId: actor.userId,
                }),
          model: loadAiConfiguration().autoLabelModel,
        };
      })();
      return await context;
    },
    getBudgetStatus: async () => await getMailAutomationAiBudgetStatus(input),
  };
};

export const discoverFreshGmailMessages = async (
  input: GmailPubSubNotificationMessage & { notificationReceivedAt?: number }
) => {
  const [account] = await db
    .select()
    .from(mailbox)
    .where(
      and(
        eq(mailbox.emailAddress, input.emailAddress.trim().toLowerCase()),
        eq(mailbox.provider, "gmail"),
        eq(mailbox.status, "connected")
      )
    )
    .limit(1);
  if (!account?.ownerUserId) {
    return { ignored: true as const, reason: "mailbox_not_connected" as const };
  }
  const providerRetryAt = await getGmailMailboxProviderRetryAt(account.id);
  if (providerRetryAt !== null && providerRetryAt.getTime() > Date.now()) {
    throw Object.assign(
      new Error("Gmail mailbox is waiting for its provider retry deadline."),
      {
        retryAfterMs: providerRetryAt.getTime() - Date.now(),
        status: 429,
      }
    );
  }
  const notificationReceivedAt = new Date(
    input.notificationReceivedAt ?? Date.now()
  );
  const recent = await runAuthorizedGmailMailbox(
    { mailboxId: account.id, userId: account.ownerUserId },
    async (accessToken) =>
      await listGmailMessageIds(accessToken, {
        maxResults: 25,
        query: `after:${Math.floor((notificationReceivedAt.getTime() - 2 * 60 * 60_000) / 1000)} -in:drafts -in:sent -in:spam -in:trash`,
      })
  ).catch(async (error: unknown) => {
    if (isGmailRateLimitedError(error)) {
      await deferGmailMailboxProvider(
        account.id,
        new Date(Date.now() + Math.max(1000, error.retryAfterMs ?? 60_000))
      );
    }
    throw error;
  });
  await enqueueGmailMessageWork({
    mailboxId: account.id,
    messageIds: recent.messageIds,
    notificationReceivedAt,
    source: "fresh",
    triggerActions: true,
  });
  return {
    ignored: false as const,
    mailboxId: account.id,
    queued: recent.messageIds.length,
  };
};

export const processNextGmailMessageWork = async (input: {
  priority: GmailWorkPriority;
  mailboxId?: string;
  onCriticalComplete?: (
    timings: GmailMessageCriticalTimings & {
      queueMs: number;
      notificationToCriticalMs: number | null;
    }
  ) => void | Promise<void>;
}) => {
  const work = await claimGmailMessageWork(input);
  if (work === null) {
    const wake = await getGmailMessageWorkWake(input);
    return {
      ...wake,
      moreReady: false,
      nextWakeAt: wake.moreReady
        ? new Date(Date.now() + 5000)
        : wake.nextWakeAt,
      status: "idle" as const,
    };
  }
  if (work.leaseToken === null) {
    throw new Error("Gmail work claim is missing its lease.");
  }
  const { leaseToken } = work;
  let criticalComplete = work.completedAt !== null;
  let actionsComplete = false;
  let retryAt: Date | null = null;
  let lastError: string | null = null;
  try {
    const [account] = await db
      .select({ account: mailbox, settings: mailboxAutomationSettings })
      .from(mailbox)
      .leftJoin(
        mailboxAutomationSettings,
        eq(mailboxAutomationSettings.mailboxId, mailbox.id)
      )
      .where(and(eq(mailbox.id, work.mailboxId), eq(mailbox.provider, "gmail")))
      .limit(1);
    if (
      !account?.account.ownerUserId ||
      account.account.status !== "connected"
    ) {
      criticalComplete = true;
      actionsComplete = true;
    } else {
      const userId = account.account.ownerUserId;
      const { organizationId } = account.account;
      const startedAt = Date.now();
      const outcome = await runAuthorizedGmailMailbox(
        { mailboxId: work.mailboxId, userId },
        async (accessToken) =>
          await processGmailMessage({
            accessToken,
            autoLabelEnabled:
              !criticalComplete &&
              (account.settings?.autoLabelEnabled ?? false),
            automationRuntime: createGmailAutomationRuntime({
              accessToken,
              mailboxId: work.mailboxId,
              organizationId,
              userId,
            }),
            extractCodes: !criticalComplete,
            gmailMessageId: work.gmailMessageId,
            mailboxId: work.mailboxId,
            onCriticalComplete: async (timings) => {
              criticalComplete = true;
              if (work.completedAt !== null) {
                return;
              }
              await input.onCriticalComplete?.({
                ...timings,
                notificationToCriticalMs:
                  work.notificationReceivedAt === null
                    ? null
                    : Date.now() - work.notificationReceivedAt.getTime(),
                queueMs: startedAt - work.createdAt.getTime(),
              });
            },
            organizationId,
            triggerActions: work.triggerActions,
            userId,
          })
      );
      const retries = [outcome.autoLabel, outcome.verificationCode].filter(
        (result) => result?.status === "retry"
      );
      for (const { retryAt: nextRetryAt } of retries) {
        if (retryAt === null || nextRetryAt < retryAt) {
          retryAt = nextRetryAt;
        }
      }
      criticalComplete ||= retries.length === 0;
      actionsComplete = work.triggerActions;
    }
  } catch (error) {
    lastError =
      error instanceof Error
        ? error.message.slice(0, 2000)
        : "Gmail work failed.";
    retryAt = new Date(
      Date.now() +
        (isGmailRateLimitedError(error)
          ? Math.max(1000, error.retryAfterMs ?? 60_000)
          : 60_000)
    );
    if (isGmailRateLimitedError(error)) {
      retryAt = await deferGmailMailboxProvider(work.mailboxId, retryAt);
    }
    throw error;
  } finally {
    await finishGmailMessageWork({
      actionsComplete,
      criticalComplete,
      id: work.id,
      lastError,
      leaseToken,
      retryAt,
    });
  }
  return {
    ...(await getGmailMessageWorkWake(input)),
    mailboxId: work.mailboxId,
    status: retryAt === null ? ("complete" as const) : ("retry" as const),
  };
};
