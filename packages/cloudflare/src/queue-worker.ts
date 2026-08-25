import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  maintainGmailPubSubMailbox,
  processGmailPubSubNotification,
} from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";

import { reportWorkerError } from "./worker-runtime";

const gmailPubSubQueueMessageSchema = z.discriminatedUnion("type", [
  z.object({
    emailAddress: z.email(),
    historyId: z.string().min(1),
    pubSubMessageId: z.string().min(1),
    type: z.literal("notification"),
  }),
  z.object({
    emailAddress: z.email(),
    mailboxId: z.string().min(1),
    type: z.literal("maintenance"),
  }),
]);

export type GmailPubSubQueueMessage = z.infer<
  typeof gmailPubSubQueueMessageSchema
>;

const broadcastMailboxDetails = async (env: Env, emailAddress: string) => {
  const id = env.GmailLiveSyncMailbox.idFromName(
    emailAddress.trim().toLowerCase()
  );
  const response = await env.GmailLiveSyncMailbox.get(id).fetch(
    "https://internal.quieter/broadcast",
    {
      body: JSON.stringify({ type: "mailbox-details-dirty" }),
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error("Gmail live-sync broadcast failed.");
  }
};

export const processGmailQueueMessage = async (
  body: unknown,
  env: Env,
  dependencies: {
    maintainMailbox?: typeof maintainGmailPubSubMailbox;
    processNotification?: typeof processGmailPubSubNotification;
  } = {}
) => {
  const message = gmailPubSubQueueMessageSchema.parse(body);
  if (message.type === "maintenance") {
    const result = await (
      dependencies.maintainMailbox ?? maintainGmailPubSubMailbox
    )({
      mailboxId: message.mailboxId,
      topicName: env.GMAIL_PUBSUB_TOPIC,
    });
    if (result.status === "busy") {
      throw new Error("Gmail mailbox is already being processed.");
    }
    if (result.status === "maintained") {
      await broadcastMailboxDetails(env, message.emailAddress);
    }
    return;
  }

  const result = await (
    dependencies.processNotification ?? processGmailPubSubNotification
  )(message, {
    onProcessed: async () => {
      await broadcastMailboxDetails(env, message.emailAddress);
    },
  });
  if (!result.ignored && result.busy === true) {
    throw new Error("Gmail mailbox is already being processed.");
  }
};

export default {
  async queue(batch, env, _ctx) {
    await withRequestDatabaseClient(async () => {
      await Promise.all(
        batch.messages.map(async (message) => {
          try {
            await processGmailQueueMessage(message.body, env);
            message.ack();
          } catch (error) {
            reportWorkerError(error, {
              category: "gmail_queue_processing_error",
              messageId: message.id,
              route: "queue",
            });
            message.retry({
              delaySeconds: Math.min(15 * 60, 5 * 2 ** message.attempts),
            });
          }
        })
      );
    });
  },
} satisfies ExportedHandler<Env>;
