import { z } from "zod";

export const mailSubmissionEventSchema = z.strictObject({
  eventType: z.enum([
    "submission.dispatch",
    "submission.accepted",
    "submission.failed",
  ]),
  id: z.uuid(),
  organizationId: z.string().min(1).max(128),
  schemaVersion: z.literal(1),
  submissionId: z.uuid(),
});

export type MailSubmissionEvent = z.infer<typeof mailSubmissionEventSchema>;

export const mailSubmissionWakeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("submission.outbox-ready"),
});
export type MailSubmissionWake = z.infer<typeof mailSubmissionWakeSchema>;
