import { requireServerEnv } from "@quieter/env/server";
import { maintainGmailPubSubMailbox } from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";

import { notifyGmailLiveSyncConnections } from "./gmail-live-sync";
import { reportAwsError } from "./sentry";

const queueMessageSchema = z.object({
  mailboxId: z.string().min(1),
  type: z.literal("maintenance"),
});

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
