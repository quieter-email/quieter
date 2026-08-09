import { requireServerEnv } from "@quieter/env/server";
import {
  maintainGmailPubSubMailbox,
  processGmailPubSubNotification,
} from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";

import { notifyGmailLiveSyncConnections } from "./gmail-live-sync";
import { reportAwsError } from "./sentry";

const queueMessageSchema = z.discriminatedUnion("type", [
  z.object({
    emailAddress: z.email(),
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
  Records: {
    body: string;
    messageId: string;
  }[];
};

export const handler = async (event: SqsEvent) => {
  const results = await Promise.all(
    event.Records.map(async (record) => {
      try {
        const message = queueMessageSchema.parse(JSON.parse(record.body));
        if (message.type === "notification") {
          await processGmailPubSubNotification(message, {
            onAccepted: async ({ mailboxId }) => {
              try {
                await notifyGmailLiveSyncConnections(mailboxId);
              } catch (error) {
                await reportAwsError(error, "GmailPubSubConsumerFanout");
              }
            },
            onProcessed: async ({ mailboxId }) => {
              try {
                await notifyGmailLiveSyncConnections(
                  mailboxId,
                  "mailbox-details-dirty"
                );
              } catch (error) {
                await reportAwsError(error, "GmailPubSubConsumerDetailsFanout");
              }
            },
          });
        } else {
          const result = await maintainGmailPubSubMailbox({
            mailboxId: message.mailboxId,
            topicName: requireServerEnv("GMAIL_PUBSUB_TOPIC"),
          });
          if (result.status === "maintained") {
            await notifyGmailLiveSyncConnections(
              message.mailboxId,
              "mailbox-details-dirty"
            );
          }
        }
        return null;
      } catch (error) {
        await reportAwsError(error, "GmailPubSubConsumer");
        return record.messageId;
      }
    })
  );

  return {
    batchItemFailures: results.flatMap((messageId) =>
      messageId === null ? [] : [{ itemIdentifier: messageId }]
    ),
  };
};
