import { z } from "zod";

import { gmailAutomationKindSchema, mailUpdateSchema } from "./updates";

const id = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative();

export const mailMaintenanceScopeKeySchema = z.string().min(1).max(512);
export const mailDispatchPath = "/mail/dispatch/event";
export const mailDispatchProbePath = "/mail/dispatch/probe";
export const MAIL_DISPATCH_PROBE_ID = "00000000-0000-4000-8000-000000000000";
export const MAIL_DISPATCH_BATCH_SIZE = 64;
export const MAIL_DISPATCH_SHARD_COUNT = 4;
export const MAIL_DISPATCH_NOTICE = "quieter_mail_dispatch";
export const mailDispatchRepairJobSchema = z.strictObject({
  shard: z.number().int().nonnegative().lt(MAIL_DISPATCH_SHARD_COUNT),
});
export const mailDispatchRequestSchema = z.strictObject({
  eventIds: z.array(z.uuid()).min(1).max(MAIL_DISPATCH_BATCH_SIZE),
  expiresAt: timestamp,
  purpose: z.literal("mail-dispatch-event"),
});
export const mailDispatchProbeSchema = z.strictObject({
  expiresAt: timestamp,
  purpose: z.literal("mail-dispatch-probe"),
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
    scopeKey: mailMaintenanceScopeKeySchema,
    task: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("live"),
    recipientUserIds: z.array(id).max(100).optional(),
    update: mailUpdateSchema,
  }),
]);

export type MailDispatchEvent = z.infer<typeof mailDispatchEventSchema>;
