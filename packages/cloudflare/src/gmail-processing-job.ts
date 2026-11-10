import { withRequestDatabaseClient } from "@quieter/database/client";
import type { GmailPubSubNotificationMessage } from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";

import { broadcastGmailUpdate, broadcastMailUpdate } from "./mail-updates";
import { reportWorkerError } from "./worker-runtime";

const notificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z.string().regex(/^\d+$/u),
  notificationReceivedAt: z.number().int().nonnegative().optional(),
  pubSubMessageId: z.string().min(1),
});

export const gmailJobSchema = z.union([
  z.object({ kind: z.literal("capture"), notification: notificationSchema }),
  z.object({
    kind: z.literal("work"),
    mailboxId: z.string().min(1),
    priority: z.enum(["fresh", "catchup"]),
  }),
  notificationSchema,
]);

export type GmailProcessingEnv = Pick<
  Env,
  | "GmailProcessingQueue"
  | "GmailFreshProcessingQueue"
  | "GmailCatchupProcessingQueue"
  | "MailLiveUser"
>;

export const GMAIL_PROCESSING_URL = "https://gmail-processing.internal/job";
export const GMAIL_JOB_BODY_LIMIT = 65_536;
export const gmailJobDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("ack") }),
  z.strictObject({
    action: z.literal("retry"),
    delaySeconds: z.number().int().min(1).max(43_200),
  }),
]);

export type GmailJob = z.infer<typeof gmailJobSchema>;
export type GmailJobDecision = z.infer<typeof gmailJobDecisionSchema>;

export const enqueueGmailMessageWork = async (
  env: GmailProcessingEnv,
  job: {
    mailboxId: string;
    priority: "fresh" | "catchup";
    nextWakeAt?: Date;
  }
) => {
  const queue =
    job.priority === "fresh"
      ? env.GmailFreshProcessingQueue
      : env.GmailCatchupProcessingQueue;
  await queue.send(
    { kind: "work", mailboxId: job.mailboxId, priority: job.priority },
    job.nextWakeAt === undefined
      ? undefined
      : {
          delaySeconds: Math.min(
            43_200,
            Math.max(
              0,
              Math.ceil((job.nextWakeAt.getTime() - Date.now()) / 1000)
            )
          ),
        }
  );
};

export const enqueueGmailNotification = async (
  notification: GmailPubSubNotificationMessage,
  env: GmailProcessingEnv,
  ctx?: Pick<ExecutionContext, "waitUntil">
) => {
  await env.GmailProcessingQueue.send({
    ...notification,
    notificationReceivedAt: Date.now(),
  });
  const broadcast = (async () => {
    try {
      await broadcastGmailUpdate(
        env,
        notification.emailAddress,
        "mailbox.changed",
        notification.historyId
      );
    } catch (error) {
      reportWorkerError(error, {
        category: "gmail_processing_intake_broadcast_error",
        route: "gmail/pubsub",
      });
    }
  })();
  if (ctx === undefined) {
    await broadcast;
  } else {
    ctx.waitUntil(broadcast);
  }
};

export const processGmailJob = async (
  parsed: GmailJob,
  env: GmailProcessingEnv
): Promise<GmailJobDecision> => {
  const { processGmailPubSubNotification } =
    await import("@quieter/orpc/gmail-pubsub");
  const {
    discoverFreshGmailMessages,
    getGmailMessageWorkWake,
    isGmailRateLimitedError,
    processNextGmailMessageWork,
  } = await import("@quieter/orpc/gmail-work");
  const scheduleGmailMessageWorkWakes = async (input: {
    mailboxId: string;
    priority: "fresh" | "catchup";
    immediateWakeCount: number;
    onWake?: () => void;
  }) => {
    const wake = await withRequestDatabaseClient(
      async () =>
        await getGmailMessageWorkWake({
          mailboxId: input.mailboxId,
          priority: input.priority,
        })
    );
    if (wake.nextWakeAt === null) {
      return;
    }
    if (wake.moreReady) {
      await Promise.all(
        Array.from({ length: input.immediateWakeCount }, async () => {
          input.onWake?.();
          await enqueueGmailMessageWork(env, {
            mailboxId: input.mailboxId,
            priority: input.priority,
          });
        })
      );
      return;
    }
    input.onWake?.();
    await enqueueGmailMessageWork(env, {
      mailboxId: input.mailboxId,
      nextWakeAt: wake.nextWakeAt,
      priority: input.priority,
    });
  };
  try {
    if (!("kind" in parsed)) {
      const discoveryStartedAt = performance.now();
      const notificationAgeMs =
        parsed.notificationReceivedAt === undefined
          ? null
          : Date.now() - parsed.notificationReceivedAt;
      let discoveryMs: number | undefined;
      let schedulingMs: number | undefined;
      let listedMessageCount: number | undefined;
      let wakeCallCount = 0;
      let outcome: "queued" | "ignored" | "retry" | "error" = "error";
      try {
        const discovery = await withRequestDatabaseClient(
          async () => await discoverFreshGmailMessages(parsed)
        );
        discoveryMs = performance.now() - discoveryStartedAt;
        outcome = discovery.ignored ? "ignored" : "queued";
        if (!discovery.ignored) {
          listedMessageCount = discovery.queued;
          const schedulingStartedAt = performance.now();
          try {
            await scheduleGmailMessageWorkWakes({
              immediateWakeCount: Math.max(1, Math.min(4, discovery.queued)),
              mailboxId: discovery.mailboxId,
              onWake: () => {
                wakeCallCount += 1;
              },
              priority: "fresh",
            });
            await env.GmailCatchupProcessingQueue.send({
              kind: "capture",
              notification: parsed,
            });
          } finally {
            schedulingMs = performance.now() - schedulingStartedAt;
          }
        }
      } catch (error) {
        outcome = isGmailRateLimitedError(error) ? "retry" : "error";
        throw error;
      } finally {
        try {
          // oxlint-disable-next-line no-console -- Fixed numeric discovery diagnostics exclude notification and mailbox data.
          console.info({
            discoveryMs: discoveryMs ?? performance.now() - discoveryStartedAt,
            event: "gmail_fresh_discovery_attempt",
            listedMessageCount,
            notificationAgeMs,
            outcome,
            schedulingMs,
            totalMs: performance.now() - discoveryStartedAt,
            wakeCallCount,
          });
        } catch {
          // Ignore diagnostic logging failures.
        }
      }
    } else if (parsed.kind === "work") {
      const result = await withRequestDatabaseClient(
        async () =>
          await processNextGmailMessageWork({
            mailboxId: parsed.mailboxId,
            onAttemptComplete: (attempt) => {
              // oxlint-disable-next-line no-console -- Attempt snapshots contain only fixed numeric measurements and finite outcomes.
              console.info({
                accountMs: attempt.accountMs,
                actionsComplete: attempt.actionsComplete,
                attemptKind: attempt.attemptKind,
                attempts: attempt.attempts,
                authorizationMs: attempt.authorizationMs,
                claimMs: attempt.claimMs,
                criticalComplete: attempt.criticalComplete,
                criticalPreviouslyComplete: attempt.criticalPreviouslyComplete,
                dueLatenessMs: attempt.dueLatenessMs,
                event: "gmail_processing_attempt",
                failedStage: attempt.failedStage,
                finishMs: attempt.finishMs,
                messageAttempts: attempt.messageAttempts,
                messageCallCount: attempt.messageCallCount,
                notificationAgeMs: attempt.notificationAgeMs,
                outcome: attempt.outcome,
                priority: attempt.priority,
                queueMs: attempt.queueMs,
                totalMs: attempt.totalMs,
                workAgeMs: attempt.workAgeMs,
              });
            },
            onCriticalComplete: async (timings) => {
              // oxlint-disable-next-line no-console -- Worker logs record numeric successful processing latency without message or account identifiers.
              console.info({
                autoLabelMs: timings.autoLabelMs,
                event: "gmail_critical_complete",
                notificationToCriticalMs: timings.notificationToCriticalMs,
                priority: parsed.priority,
                queueMs: timings.queueMs,
                totalMs: timings.totalMs,
                verificationCodeMs: timings.verificationCodeMs,
              });
              try {
                await broadcastMailUpdate(env, {
                  eventId: crypto.randomUUID(),
                  mailboxId: parsed.mailboxId,
                  type: "mailbox.changed",
                });
              } catch (error) {
                reportWorkerError(error, {
                  category: "gmail_processing_critical_broadcast_error",
                  route: "queue",
                });
              }
            },
            priority: parsed.priority,
          })
      );
      // oxlint-disable-next-line no-console -- Count deferred work independently from successful critical completion.
      console.info({
        activeLeases:
          result.status === "capacity_busy" ? result.activeLeases : undefined,
        capacityBusy: Number(result.status === "capacity_busy"),
        complete: Number(result.status === "complete"),
        deferred: Number(
          result.status === "idle" && result.nextWakeAt !== null
        ),
        event: "gmail_message_work_result",
        idle: Number(result.status === "idle"),
        priority: parsed.priority,
        retry: Number(result.status === "retry"),
      });
      if (result.status === "complete") {
        try {
          await broadcastMailUpdate(env, {
            eventId: crypto.randomUUID(),
            mailboxId: parsed.mailboxId,
            type: "mailbox.changed",
          });
        } catch (error) {
          reportWorkerError(error, {
            category: "gmail_processing_completion_broadcast_error",
            route: "queue",
          });
        }
      }
      if (result.nextWakeAt !== null) {
        await enqueueGmailMessageWork(env, {
          mailboxId: parsed.mailboxId,
          nextWakeAt:
            result.status === "capacity_busy"
              ? new Date(
                  Math.max(result.nextWakeAt.getTime(), Date.now() + 5000)
                )
              : result.nextWakeAt,
          priority: parsed.priority,
        });
      } else if (result.status === "retry") {
        return { action: "retry", delaySeconds: 60 };
      }
    } else {
      const { notification } = parsed;
      const result = await withRequestDatabaseClient(
        async () =>
          await processGmailPubSubNotification(notification, {
            maxHistoryPages: 1,
            onAccepted: async () => {
              await broadcastGmailUpdate(
                env,
                notification.emailAddress,
                "mailbox.changed",
                notification.historyId
              );
            },
          })
      );
      if (!result.ignored) {
        await Promise.all(
          (["fresh", "catchup"] as const).map(async (priority) => {
            await scheduleGmailMessageWorkWakes({
              immediateWakeCount: priority === "fresh" ? 4 : 2,
              mailboxId: result.mailboxId,
              priority,
            });
          })
        );
        await broadcastGmailUpdate(
          env,
          notification.emailAddress,
          "mailbox.changed"
        );
        if (result.busy) {
          return {
            action: "retry",
            delaySeconds: Math.min(
              43_200,
              Math.max(1, Math.ceil((result.retryAfterMs ?? 60_000) / 1000))
            ),
          };
        }
        if (result.needsContinuation) {
          await env.GmailCatchupProcessingQueue.send(parsed, {
            delaySeconds: 1,
          });
        }
      }
    }
    return { action: "ack" };
  } catch (error) {
    // oxlint-disable-next-line no-console -- Count exceptions separately from successful critical completion.
    console.info({ errors: 1, event: "gmail_processing_queue_error" });
    reportWorkerError(error, {
      category: "gmail_processing_queue_error",
      route: "queue",
    });
    return {
      action: "retry",
      delaySeconds: isGmailRateLimitedError(error)
        ? Math.min(
            43_200,
            Math.max(1, Math.ceil((error.retryAfterMs ?? 60_000) / 1000))
          )
        : 60,
    };
  }
};
