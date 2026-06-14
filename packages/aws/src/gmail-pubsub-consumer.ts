import { requireServerEnv } from "@quieter/env/server";
import {
  maintainGmailPubSubMailbox,
  processGmailPubSubNotification,
} from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";
import { notifyGmailLiveSyncConnections } from "./gmail-live-sync";

const queueMessageSchema = z.discriminatedUnion("type", [
  z.object({
    emailAddress: z.string().email(),
    historyId: z.string().min(1),
    pubSubMessageId: z.string().min(1),
    type: z.literal("notification"),
  }),
  z.object({
    mailboxId: z.string().min(1),
    type: z.literal("maintenance"),
  }),
]);

type SqsEvent = {
  Records: Array<{
    body: string;
    messageId: string;
  }>;
};

export const handler = async (event: SqsEvent) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message = queueMessageSchema.parse(JSON.parse(record.body));
      if (message.type === "notification") {
        await processGmailPubSubNotification(message, {
          onAccepted: async ({ mailboxId }) => {
            try {
              await notifyGmailLiveSyncConnections(mailboxId);
            } catch (error) {
              console.error(
                `Could not fan out Gmail live-sync notification for mailbox ${mailboxId}.`,
                error instanceof Error ? error.message : "Unknown error.",
              );
            }
          },
        });
      } else {
        await maintainGmailPubSubMailbox({
          mailboxId: message.mailboxId,
          topicName: requireServerEnv("GMAIL_PUBSUB_TOPIC"),
        });
      }
    } catch (error) {
      console.error(
        `Could not process Gmail Pub/Sub queue message ${record.messageId}.`,
        error instanceof Error ? error.message : "Unknown error.",
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
