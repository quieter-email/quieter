import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { serverEnv } from "@quieter/env/server";
import { Resource } from "sst";
import { z } from "zod";
import {
  bearerTokenMatches,
  getBearerToken,
  parseEventJson,
  toJson,
  type LambdaFunctionUrlEvent,
  type LambdaFunctionUrlResponse,
} from "./function-url";

const enqueuePayloadSchema = z.object({
  runId: z.string().trim().min(1),
});

let sqsClient: SQSClient | null = null;

const getSqsClient = () => {
  sqsClient ??= new SQSClient({
    region: serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION,
  });

  return sqsClient;
};

export const handler = async (
  event: LambdaFunctionUrlEvent,
): Promise<LambdaFunctionUrlResponse> => {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase();

    if (method !== "POST") {
      return toJson({ error: "Method not allowed" }, 405);
    }

    const token = getBearerToken(event.headers);
    const expectedToken = Resource.ChatGenerationStartToken.value;

    if (!bearerTokenMatches(token, expectedToken)) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    const payload = enqueuePayloadSchema.parse(parseEventJson(event));
    const queueUrl = Resource.ChatGenerationQueue.url;

    await getSqsClient().send(
      new SendMessageCommand({
        MessageBody: JSON.stringify({ runId: payload.runId }),
        QueueUrl: queueUrl,
      }),
    );

    return toJson({ enqueued: true, runId: payload.runId });
  } catch {
    return toJson({ error: "Could not enqueue chat generation." }, 400);
  }
};
