import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { gmailAutomationKindSchema } from "@quieter/mail/updates";
import { getGmailMailboxAutomationWakes } from "@quieter/orpc/gmail-mailbox-automation/readiness";

import {
  gmailDispatchSchema,
  gmailMailboxScheduler,
} from "./gmail-mailbox-scheduler";
import type {
  GmailDispatch,
  GmailMailboxScheduler,
} from "./gmail-mailbox-scheduler";
import { withProjectGmailQuota } from "./gmail-project-quota";
import { broadcastMailUpdate } from "./mail-updates";
import { reportWorkerError } from "./worker-runtime";

type ExecutionOutcome = Parameters<GmailMailboxScheduler["finish"]>[1];
const RECONCILIATION_INTERVAL_MS = 2 * 60 * 60_000;

const runGmailMailboxTask = async (
  { mailboxId, notification, task }: GmailDispatch,
  env: Env
): Promise<ExecutionOutcome> => {
  const automation = gmailAutomationKindSchema.safeParse(task);
  if (automation.success) {
    const { processGmailMailboxAutomation } =
      await import("@quieter/orpc/gmail-mailbox-automation");
    const result = await processGmailMailboxAutomation({
      allowLocal: serverEnv.QUIETER_LOCAL_PROVIDER_MODE === "write",
      kind: automation.data,
      limit: task === "actions" ? 1 : 4,
      mailboxId,
    });
    return {
      nextAt:
        result.nextWakeAt === null
          ? null
          : Math.max(result.nextWakeAt, Date.now() + 1000),
    };
  }

  const notify = async () => {
    try {
      await broadcastMailUpdate(env, {
        eventId: crypto.randomUUID(),
        mailboxId,
        type: "mailbox.changed",
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "gmail_mailbox_broadcast_failed",
        route: "queue",
      });
    }
  };
  if (task === "sync") {
    if (notification === undefined) {
      const { pruneCompletedGmailMessageWork } =
        await import("@quieter/orpc/gmail-work");
      await pruneCompletedGmailMessageWork(mailboxId);
    }
    const { maintainGmailPubSubMailbox } =
      await import("@quieter/orpc/gmail-pubsub");
    const result = await maintainGmailPubSubMailbox({
      ...notification,
      mailboxId,
      topicName: env.GMAIL_PUBSUB_TOPIC,
    });
    if (result.status === "skipped" || result.status === "retired") {
      return { nextAt: null, retired: result.status === "retired" };
    }
    if (result.status === "busy") {
      const retryAt = Date.now() + result.retryAfterMs;
      return { nextAt: retryAt, retryAt };
    }
    await notify();
    const now = Date.now();
    let messageWakes: Partial<Record<"fresh" | "catchup", number>> = {
      catchup: now,
      fresh: now,
    };
    if (serverEnv.QUIETER_GMAIL_EVENTS_ENABLED === true) {
      const { getGmailMessageWorkWake } =
        await import("@quieter/orpc/gmail-work");
      const candidates = await Promise.all(
        (["fresh", "catchup"] as const).map(async (priority) => {
          const { nextWakeAt } = await getGmailMessageWorkWake({
            mailboxId,
            priority,
          });
          return { nextWakeAt, priority };
        })
      );
      messageWakes = Object.fromEntries(
        candidates.flatMap(({ nextWakeAt, priority }) =>
          nextWakeAt === null ? [] : [[priority, nextWakeAt.getTime()]]
        )
      );
    }
    return {
      continueNotification: result.status === "pending",
      nextAt:
        result.status === "pending"
          ? now + 5000
          : Math.min(
              now +
                RECONCILIATION_INTERVAL_MS +
                Math.floor(Math.random() * 10 * 60_000),
              result.nextWatchAt === null
                ? Infinity
                : Math.max(now + 5000, result.nextWatchAt)
            ),
      wakeDiscovery: result.needsFreshDiscovery && notification !== undefined,
      wakes: {
        ...(await getGmailMailboxAutomationWakes(mailboxId)),
        ...messageWakes,
      },
    };
  }

  const {
    createGmailAutomationRuntime,
    discoverFreshGmailMessages,
    getGmailMessageWorkWake,
    processNextGmailMessageWork,
  } = await import("@quieter/orpc/gmail-work");
  if (task === "discover") {
    const { willNeedGmailFreshDiscovery } =
      await import("@quieter/orpc/gmail-pubsub");
    if (
      !(await willNeedGmailFreshDiscovery({
        mailboxId,
        observedHistoryId: notification?.observedHistoryId,
      }))
    ) {
      return { nextAt: null };
    }
    const result = await discoverFreshGmailMessages({
      mailboxId,
      notificationReceivedAt: notification?.notificationReceivedAt,
    });
    return result.ignored
      ? { nextAt: null }
      : { nextAt: null, wakes: { fresh: Date.now() } };
  }

  if (task !== "fresh" && task !== "catchup") {
    throw new Error("Unknown Gmail mailbox task.");
  }
  const work = { mailboxId, priority: task };
  const runtimes = new Map<
    string,
    ReturnType<typeof createGmailAutomationRuntime>
  >();
  let broadcast: Promise<void> | undefined;
  const outcomes = await Promise.allSettled(
    Array.from(
      { length: task === "fresh" ? 2 : 6 },
      async () =>
        await processNextGmailMessageWork({
          ...work,
          automationRuntime: (context) => {
            const key = JSON.stringify([
              context.mailboxId,
              context.userId,
              context.organizationId,
              context.accessToken,
            ]);
            const existing = runtimes.get(key);
            if (existing !== undefined) {
              return existing;
            }
            const runtime = createGmailAutomationRuntime(context);
            runtimes.set(key, runtime);
            return runtime;
          },
          onAttemptComplete: (attempt) => {
            // oxlint-disable-next-line no-console -- Timing snapshots contain no mailbox or message data.
            console.info({ event: "gmail_processing_attempt", ...attempt });
          },
          onCriticalComplete: async () => {
            broadcast ??= notify();
            await broadcast;
          },
        })
    )
  );
  if (
    outcomes.some(
      (outcome) =>
        outcome.status === "fulfilled" && outcome.value.status === "complete"
    )
  ) {
    await notify();
  }
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure !== undefined) {
    throw failure.reason;
  }

  const wake = await getGmailMessageWorkWake(work);
  const idle = outcomes.every(
    (outcome) =>
      outcome.status === "fulfilled" && outcome.value.status === "idle"
  );
  return {
    nextAt:
      wake.nextWakeAt === null
        ? null
        : Math.max(wake.nextWakeAt.getTime(), Date.now() + (idle ? 5000 : 0)),
    wakes: idle ? undefined : await getGmailMailboxAutomationWakes(mailboxId),
  };
};

export const executeGmailMailboxDispatch = async (
  batch: MessageBatch,
  env: Env
) => {
  const {
    AiProviderDeferredError,
    GmailBackgroundQuotaDeferredError,
    isGmailRateLimitedError,
  } = await import("@quieter/orpc/gmail-work");
  await Promise.all(
    batch.messages.map(async (message) => {
      const parsed = gmailDispatchSchema.safeParse(message.body);
      if (!parsed.success) {
        message.retry();
        return;
      }
      const dispatch = parsed.data;
      const scheduler = gmailMailboxScheduler(env, dispatch.mailboxId);
      try {
        if (!(await scheduler.start(dispatch))) {
          message.ack();
          return;
        }
        let outcome: ExecutionOutcome;
        try {
          outcome = await withRequestDatabaseClient(
            async () =>
              await withProjectGmailQuota(
                env,
                dispatch,
                async () => await runGmailMailboxTask(dispatch, env)
              )
          );
        } catch (error) {
          if (
            error instanceof GmailBackgroundQuotaDeferredError ||
            error instanceof AiProviderDeferredError
          ) {
            outcome = { nextAt: error.retryAt, retryAt: error.retryAt };
          } else {
            reportWorkerError(error, {
              category: "gmail_mailbox_execution_failed",
              route: "queue",
            });
            const retryAt =
              Date.now() +
              (isGmailRateLimitedError(error)
                ? Math.max(1000, error.retryAfterMs ?? 60_000)
                : 60_000);
            outcome = { nextAt: retryAt, retryAt };
          }
        }
        let applied: boolean;
        try {
          applied = await scheduler.finish(dispatch, outcome);
        } catch {
          applied = await gmailMailboxScheduler(env, dispatch.mailboxId).finish(
            dispatch,
            outcome
          );
        }
        if (
          applied &&
          serverEnv.QUIETER_GMAIL_EVENTS_ENABLED !== true &&
          dispatch.task === "sync" &&
          outcome.retryAt === undefined &&
          outcome.wakes !== undefined
        ) {
          const { recordGmailSchedulerHeartbeat } =
            await import("@quieter/orpc/gmail-pubsub");
          await withRequestDatabaseClient(async () => {
            await recordGmailSchedulerHeartbeat(dispatch.mailboxId);
          });
        }
        message.ack();
      } catch (error) {
        reportWorkerError(error, {
          category: "gmail_mailbox_completion_failed",
          route: "queue",
        });
        message.retry();
      }
    })
  );
};
