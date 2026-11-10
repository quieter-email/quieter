import { z } from "zod";

import { composeMessageInputSchema } from "./compose/schema";
import { reminderTimeZoneSchema } from "./reminders";

export const scheduledSendStatusSchema = z.enum([
  "preparing",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "uncertain",
  "cancelled",
]);
export type ScheduledSendStatus = z.infer<typeof scheduledSendStatusSchema>;

export const scheduledSendTimeSchema = z.object({
  sendAt: z.iso.datetime({ offset: true }),
  timeZone: reminderTimeZoneSchema,
});
export type ScheduledSendTime = z.infer<typeof scheduledSendTimeSchema>;

export const createScheduledSendSchema = scheduledSendTimeSchema.extend({
  mailboxId: z.string().min(1),
  message: composeMessageInputSchema,
});
export const scheduledSendMailboxSchema = z.object({
  mailboxId: z.string().min(1),
});
export const scheduledSendActionSchema = scheduledSendMailboxSchema.extend({
  id: z.uuid(),
});
export const rescheduleSendSchema = scheduledSendActionSchema.extend(
  scheduledSendTimeSchema.shape
);
export const scheduledSendOperationSchema = scheduledSendMailboxSchema.extend({
  sendOperationId: z.uuid(),
});
