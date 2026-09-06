import { z } from "zod";

export const feedbackBridgeEnvelopeSchema = z.object({
  Message: z
    .string()
    .min(1)
    .max(128 * 1024),
  MessageId: z.string().regex(/^[\w-]{1,128}$/u),
  TopicArn: z.string().min(1).max(512),
  Type: z.literal("Notification"),
});

export const feedbackBridgeReceiptSchema = z.strictObject({
  eventId: z.string(),
  schemaVersion: z.literal(1),
  status: z.literal("retained"),
});

export const readFeedbackBridgeBody = async (
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<string> => {
  if (
    body === null ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 128 * 1024
  ) {
    throw new Error("Invalid feedback body.");
  }
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0;
        let text = "";
        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- Bound each chunk before retaining it.
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          size += chunk.value.byteLength;
          if (size > limit) {
            throw new Error("Feedback body exceeds its limit.");
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        return text + decoder.decode();
      })(),
      // oxlint-disable-next-line promise/avoid-new -- Bound the complete native body stream, including stalled producers.
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Feedback body deadline exceeded."));
        }, 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // oxlint-disable-next-line promise/prefer-await-to-then -- Cancellation can itself wait for a stalled producer.
    void reader.cancel().catch(() => {
      /* The caller already has the outcome. */
    });
    reader.releaseLock();
  }
};
