import { executeMailboxActionRun } from "@quieter/orpc/mailbox-actions";
import { z } from "zod";

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
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const { runId } = queuePayloadSchema.parse(JSON.parse(record.body));
      await executeMailboxActionRun(runId);
    } catch (error) {
      console.error(
        `Could not process mailbox action queue message ${record.messageId}.`,
        error instanceof Error ? error.message : "Unknown error.",
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
