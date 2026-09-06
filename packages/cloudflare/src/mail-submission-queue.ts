import type { MailOutboxEvent } from "@quieter/database/mail-outbox";
import { mailSubmissionEventSchema } from "@quieter/mail/submission-events";
import type { MailSubmissionEvent } from "@quieter/mail/submission-events";

import { withMailOperationDeadline } from "./mail-operation-deadline.ts";

export type MailSubmissionQueueBindings = {
  MailSubmissionDispatchQueue: Pick<Queue<MailSubmissionEvent>, "send">;
  MailSubmissionProjectionQueue: Pick<Queue<MailSubmissionEvent>, "send">;
};

export const publishMailSubmissionEvent = async (
  bindings: MailSubmissionQueueBindings,
  input: MailOutboxEvent
) => {
  const parsed = mailSubmissionEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      "Unsupported durable mail event. Preserve it for a compatible consumer."
    );
  }
  const event = parsed.data;
  const queue =
    event.eventType === "submission.dispatch"
      ? bindings.MailSubmissionDispatchQueue
      : bindings.MailSubmissionProjectionQueue;
  await withMailOperationDeadline(queue.send(event, { contentType: "json" }));
  return `queue_accepted:${event.id}`;
};
