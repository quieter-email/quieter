import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
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

const isDuplicateWorkflowStart = async (error: unknown) => {
  if (!(error instanceof workflow.StartError)) {
    return false;
  }

  const body = await error.response.text().catch(() => "");
  return body.includes("ExecutionAlreadyExists");
};

export const handler = async (event: SqsEvent) => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const { runId } = queuePayloadSchema.parse(JSON.parse(record.body));

      try {
        await workflow.start(Resource.ChatGenerationWorkflow, {
          name: runId,
          payload: { runId },
        });
      } catch (error) {
        if (await isDuplicateWorkflowStart(error)) {
          continue;
        }

        throw error;
      }
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
