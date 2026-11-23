import { z } from "zod";

import { gmailAutomationKindSchema, mailUpdateSchema } from "./updates";

const id = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative();

export const mailDispatchPath = "/mail/dispatch/event";
export const mailDispatchRequestSchema = z.strictObject({
  eventId: z.uuid(),
  expiresAt: timestamp,
  purpose: z.literal("mail-dispatch-event"),
});

export const gmailDispatchTaskSchema = z.union([
  gmailAutomationKindSchema,
  z.literal("catchup"),
  z.literal("fresh"),
  z.literal("sync"),
]);

export const mailDispatchEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("gmail-enrollment") }),
  z.strictObject({ kind: z.literal("maintenance-enrollment") }),
  z.strictObject({
    dueAt: timestamp.optional(),
    kind: z.literal("gmail"),
    mailboxId: id,
    tasks: z.array(gmailDispatchTaskSchema).min(1).max(7),
  }),
  z.strictObject({
    dueAt: timestamp.optional(),
    kind: z.literal("maintenance"),
    scopeKey: z.string().min(1).max(2048),
    task: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("live"),
    recipientUserIds: z.array(id).max(100).optional(),
    update: mailUpdateSchema,
  }),
]);

export type MailDispatchEvent = z.infer<typeof mailDispatchEventSchema>;
