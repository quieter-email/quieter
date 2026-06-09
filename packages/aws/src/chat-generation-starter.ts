import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
import { z } from "zod";

const queuePayloadSchema = z.object({
  runId: z.string().trim().min(1),
});

type SqsRecord = {
  body: string;
};

type SqsEvent = {
  Records: SqsRecord[];
};

export const handler = async (event: SqsEvent) => {
  for (const record of event.Records) {
    const { runId } = queuePayloadSchema.parse(JSON.parse(record.body));

    await workflow.start(Resource.ChatGenerationWorkflow, {
      name: runId,
      payload: { runId },
    });
  }
};
