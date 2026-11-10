import { withRequestDatabaseClient } from "@quieter/database/client";
import type { GmailPubSubNotificationMessage } from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";

import { broadcastGmailUpdate } from "./mail-updates";
import { reportWorkerError } from "./worker-runtime";

const notificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z.string().regex(/^\d+$/u),
  pubSubMessageId: z.string().min(1),
});

export const enqueueGmailNotification = async (
  notification: GmailPubSubNotificationMessage,
  env: Env,
  ctx?: Pick<ExecutionContext, "waitUntil">
) => {
  await env.GmailProcessingQueue.send(notification);
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
  for (const message of batch.messages) {
    try {
      const parsed = notificationSchema.safeParse(message.body);
      if (!parsed.success) {
        throw new Error("Invalid Gmail processing queue message.");
      }
      const notification = parsed.data;
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
          await env.GmailProcessingQueue.send(notification, {
            delaySeconds: 10,
          });
        }
      }
      message.ack();
    } catch (error) {
      reportWorkerError(error, {
        category: "gmail_processing_queue_error",
        route: "queue",
      });
      message.retry({ delaySeconds: 60 });
    }
  }
};
