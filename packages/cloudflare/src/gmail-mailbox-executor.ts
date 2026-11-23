import { withRequestDatabaseClient } from "@quieter/database/client";

import {
  gmailDispatchSchema,
  gmailMailboxScheduler,
} from "./gmail-mailbox-scheduler";
import type {
  GmailDispatch,
  GmailMailboxScheduler,
} from "./gmail-mailbox-scheduler";
import { broadcastMailUpdate } from "./mail-updates";
import { reportWorkerError } from "./worker-runtime";

type ExecutionOutcome = Parameters<GmailMailboxScheduler["finish"]>[1];
const RECONCILIATION_INTERVAL_MS = 2 * 60 * 60_000;

const runGmailMailboxTask = async (
  { mailboxId, task }: GmailDispatch,
  env: Env
): Promise<ExecutionOutcome> => {
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
    const { maintainGmailPubSubMailbox } =
      await import("@quieter/orpc/gmail-pubsub");
    const result = await maintainGmailPubSubMailbox({
      mailboxId,
      topicName: env.GMAIL_PUBSUB_TOPIC,
    });
    if (result.status === "skipped") {
      return { nextAt: null };
    }
    if (result.status === "busy") {
      const retryAt = Date.now() + 60_000;
      return { nextAt: retryAt, retryAt };
    }
    await notify();
    const now = Date.now();
    return {
      nextAt:
        result.status === "pending"
          ? now + 5000
          : now +
            RECONCILIATION_INTERVAL_MS +
            Math.floor(Math.random() * 10 * 60_000),
      wakes: { catchup: now, fresh: now },
    };
  }

  const {
    discoverFreshGmailMessages,
    getGmailMessageWorkWake,
    processNextGmailMessageWork,
  } = await import("@quieter/orpc/gmail-work");
  if (task === "discover") {
    const result = await discoverFreshGmailMessages({ mailboxId });
    return result.ignored
      ? { nextAt: null }
      : { nextAt: null, wakes: { fresh: Date.now() } };
  }

  const work = { mailboxId, priority: task };
  let broadcast: Promise<void> | undefined;
  const outcomes = await Promise.allSettled(
    Array.from(
      { length: task === "fresh" ? 2 : 6 },
      async () =>
        await processNextGmailMessageWork({
          ...work,
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
  };
};

export const executeGmailMailboxDispatch = async (
  batch: MessageBatch,
  env: Env
) => {
  const { isGmailRateLimitedError } = await import("@quieter/orpc/gmail-work");
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
            async () => await runGmailMailboxTask(dispatch, env)
          );
        } catch (error) {
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
