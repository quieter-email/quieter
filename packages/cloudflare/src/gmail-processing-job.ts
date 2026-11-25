import { gmailDispatchTaskSchema } from "@quieter/mail/dispatch";
import { gmailAutomationKindSchema } from "@quieter/mail/updates";
import { z } from "zod";

const notificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z.string().max(64).regex(/^\d+$/u),
  notificationReceivedAt: z.number().int().nonnegative().optional(),
  pubSubMessageId: z.string().min(1),
});

export const gmailJobSchema = z.union([
  z.object({
    dueAt: z.number().int().nonnegative().optional(),
    kind: z.literal("dispatch-wake"),
    mailboxId: z.string().min(1),
    tasks: z.array(gmailDispatchTaskSchema).min(1).max(7),
  }),
  z.object({ kind: z.literal("capture"), notification: notificationSchema }),
  z.object({
    kind: z.literal("work"),
    mailboxId: z.string().min(1),
    notBefore: z.number().int().nonnegative().optional(),
    priority: z.enum(["fresh", "catchup"]),
  }),
  z.object({
    kind: z.literal("automation"),
    mailboxId: z.string().min(1),
    tasks: z.array(gmailAutomationKindSchema).min(1).max(4),
  }),
  z.object({ kind: z.literal("maintain"), mailboxId: z.string().min(1) }),
  notificationSchema,
]);

export const GMAIL_PROCESSING_URL = "https://gmail-processing.internal/job";
export const GMAIL_JOB_BODY_LIMIT = 65_536;
export const gmailJobDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("ack") }),
  z.strictObject({
    action: z.literal("retry"),
    delaySeconds: z.number().int().min(1).max(43_200),
  }),
]);

export type GmailJob = z.infer<typeof gmailJobSchema>;
