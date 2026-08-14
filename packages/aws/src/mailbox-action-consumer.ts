import { executeMailboxActionRun } from "@quieter/orpc/mailbox-actions";
import { z } from "zod";

import { reportAwsError } from "./sentry";

const queuePayloadSchema = z.object({
  runId: z.string().trim().min(1),
});

type SqsRecord = {
  body: string;
  messageId: string;
};

type SqsEvent = {
  Records: SqsRecord[];
};

export const handler = async (event: SqsEvent) => {
  const results = await Promise.all(
    event.Records.map(async (record) => {
      try {
        const { runId } = queuePayloadSchema.parse(JSON.parse(record.body));
        await executeMailboxActionRun(runId);
        return null;
      } catch (error) {
        await reportAwsError(error, "MailboxActionConsumer");
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
