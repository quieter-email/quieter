import { createMailFeedbackEnv } from "@quieter/env/mail-feedback";
import {
  feedbackBridgeEnvelopeSchema,
  feedbackBridgeReceiptSchema,
  readFeedbackBridgeBody,
} from "@quieter/mail/feedback-bridge";
import { z } from "zod";

import { reportAwsError } from "./sentry.ts";

const eventSchema = z.object({
  Records: z
    .array(
      z.object({
        body: z.string(),
        eventSource: z.literal("aws:sqs"),
        eventSourceARN: z.string(),
        messageId: z.string().min(1),
      })
    )
    .max(10),
});

export const forwardMailFeedbackBatch = async (
  event: unknown,
  config: NonNullable<ReturnType<typeof createMailFeedbackEnv>>
) => {
  const { Records: records } = eventSchema.parse(event);
  const [record, ...remaining] = records;
  const batchItemFailures = remaining.map((item) => ({
    itemIdentifier: item.messageId,
  }));
  if (record === undefined) {
    return { batchItemFailures };
  }
  try {
    if (
      record.eventSourceARN !== config.queueArn ||
      Buffer.byteLength(record.body) > 128 * 1024
    ) {
      throw new Error("Invalid feedback queue envelope.");
    }
    const envelope = feedbackBridgeEnvelopeSchema.parse(
      JSON.parse(record.body)
    );
    if (envelope.TopicArn !== config.topicArn) {
      throw new Error("Invalid feedback source.");
    }
    const response = await fetch(config.endpoint, {
      body: JSON.stringify(envelope),
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        "x-quieter-feedback-version": "1",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200 && response.status !== 201) {
      // oxlint-disable-next-line promise/prefer-await-to-then -- Do not wait for a failed endpoint's body cancellation.
      void response.body?.cancel().catch(() => {
        /* The record will retry. */
      });
      throw new Error("Feedback intake did not confirm retention.");
    }
    const receipt = await readFeedbackBridgeBody(response.body, 1024);
    const confirmed = feedbackBridgeReceiptSchema.parse(JSON.parse(receipt));
    if (confirmed.eventId !== envelope.MessageId) {
      throw new Error("Feedback receipt identity differs.");
    }
  } catch {
    batchItemFailures.push({ itemIdentifier: record.messageId });
    await reportAwsError(
      new Error("Mail feedback forwarding failed."),
      "MailFeedbackBridge"
    );
  }
  return { batchItemFailures };
};

export const handler = async (event: unknown) => {
  try {
    const config = createMailFeedbackEnv();
    if (config === null) {
      throw new Error("Mail feedback bridge is disabled.");
    }
    return await forwardMailFeedbackBatch(event, config);
  } catch {
    throw new Error("Mail feedback bridge could not process its batch.");
  }
};
