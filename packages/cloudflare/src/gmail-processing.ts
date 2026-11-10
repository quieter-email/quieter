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

const queueMessageSchema = z.union([
  z.object({ kind: z.literal("capture"), notification: notificationSchema }),
  z.object({
    kind: z.literal("work"),
    mailboxId: z.string().min(1),
    priority: z.enum(["fresh", "catchup"]),
  }),
  notificationSchema,
]);

export const enqueueGmailMessageWork = async (
  env: Env,
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
  env: Env,
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

export const processGmailQueue = async (batch: MessageBatch, env: Env) => {
  const { processGmailPubSubNotification } =
    await import("@quieter/orpc/gmail-pubsub");
  const {
    discoverFreshGmailMessages,
    isGmailRateLimitedError,
    processNextGmailMessageWork,
  } = await import("@quieter/orpc/gmail-work");
  for (const message of batch.messages) {
    try {
      const parsed = queueMessageSchema.parse(message.body);
      if (!("kind" in parsed)) {
        const discovery = await withRequestDatabaseClient(
          async () => await discoverFreshGmailMessages(parsed)
        );
        if (!discovery.ignored) {
          await Promise.all(
            Array.from(
              { length: Math.max(1, Math.min(4, discovery.queued)) },
              async () => {
                await enqueueGmailMessageWork(env, {
                  mailboxId: discovery.mailboxId,
                  priority: "fresh",
                });
              }
            )
          );
          await env.GmailCatchupProcessingQueue.send({
            kind: "capture",
            notification: parsed,
          });
        }
      } else if (parsed.kind === "work") {
        const result = await withRequestDatabaseClient(
          async () =>
            await processNextGmailMessageWork({
              mailboxId: parsed.mailboxId,
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
            nextWakeAt: result.nextWakeAt,
            priority: parsed.priority,
          });
        } else if (result.status === "retry") {
          message.retry({ delaySeconds: 60 });
          continue;
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
            (["fresh", "catchup"] as const).flatMap((priority) =>
              Array.from({ length: priority === "fresh" ? 4 : 2 }, async () => {
                await enqueueGmailMessageWork(env, {
                  mailboxId: result.mailboxId,
                  priority,
                });
              })
            )
          );
          await broadcastGmailUpdate(
            env,
            notification.emailAddress,
            "mailbox.changed"
          );
          if (result.busy) {
            message.retry({
              delaySeconds: Math.min(
                43_200,
                Math.max(1, Math.ceil((result.retryAfterMs ?? 60_000) / 1000))
              ),
            });
            continue;
          }
          if (result.needsContinuation) {
            await env.GmailCatchupProcessingQueue.send(parsed, {
              delaySeconds: 1,
            });
          }
        }
      }
      message.ack();
    } catch (error) {
      // oxlint-disable-next-line no-console -- Count exceptions separately from successful critical completion.
      console.info({ errors: 1, event: "gmail_processing_queue_error" });
      reportWorkerError(error, {
        category: "gmail_processing_queue_error",
        route: "queue",
      });
      message.retry({
        delaySeconds: isGmailRateLimitedError(error)
          ? Math.min(
              43_200,
              Math.max(1, Math.ceil((error.retryAfterMs ?? 60_000) / 1000))
            )
          : 60,
      });
    }
  }
};
