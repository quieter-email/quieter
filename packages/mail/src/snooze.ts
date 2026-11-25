import { z } from "zod";

import { reminderDueAtSchema, reminderTimeZoneSchema } from "./reminders";

const sourceIdSchema = z.string().trim().min(1).max(255);
const scheduleFields = {
  returnAt: reminderDueAtSchema,
  timeZone: reminderTimeZoneSchema.refine(
    (value) => !value.startsWith("+") && !value.startsWith("-"),
    "Choose a named time zone."
  ),
};

export const mailSnoozeStatusSchema = z.enum([
  "preparing",
  "active",
  "returning",
  "returned",
  "cancelled",
  "superseded",
  "suspended",
  "failed",
  "uncertain",
]);
export type MailSnoozeStatus = z.infer<typeof mailSnoozeStatusSchema>;

export const MAIL_SNOOZE_LIVE_STATUSES = [
  "preparing",
  "active",
  "returning",
  "suspended",
  "failed",
  "uncertain",
] as const satisfies readonly MailSnoozeStatus[];

export type MailSnoozeLiveStatus = (typeof MAIL_SNOOZE_LIVE_STATUSES)[number];

export const isMailSnoozeLiveStatus = (
  status: MailSnoozeStatus
): status is MailSnoozeLiveStatus =>
  MAIL_SNOOZE_LIVE_STATUSES.some((liveStatus) => liveStatus === status);

export const mailSnoozeCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("snooze"), ...scheduleFields }),
  z.strictObject({ kind: z.literal("reschedule"), ...scheduleFields }),
  z.strictObject({ kind: z.literal("cancel") }),
  z.strictObject({ kind: z.literal("return-now") }),
]);
export type MailSnoozeCommand = z.infer<typeof mailSnoozeCommandSchema>;

export const mailSnoozeApplySchema = z
  .strictObject({
    command: mailSnoozeCommandSchema,
    mailboxId: sourceIdSchema,
    requestId: z.uuid(),
    targets: z
      .array(
        z.strictObject({
          expectedVersion: z.number().int().nonnegative().nullable(),
          messageIds: z.array(sourceIdSchema).max(1000).default([]),
          threadId: sourceIdSchema,
        })
      )
      .min(1)
      .max(1000),
  })
  .superRefine((input, context) => {
    if (
      new Set(input.targets.map((target) => target.threadId)).size !==
      input.targets.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A conversation can appear only once in an action.",
        path: ["targets"],
      });
    }
    if (
      input.targets.reduce(
        (count, target) => count + target.messageIds.length,
        0
      ) > 1000
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose fewer messages for this action.",
        path: ["targets"],
      });
    }
    for (const [index, target] of input.targets.entries()) {
      if (input.command.kind === "snooze" && target.messageIds.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Choose messages to snooze.",
          path: ["targets", index, "messageIds"],
        });
      }
      if (input.command.kind !== "snooze" && target.expectedVersion === null) {
        context.addIssue({
          code: "custom",
          message: "Refresh this conversation before changing its snooze.",
          path: ["targets", index, "expectedVersion"],
        });
      }
    }
  })
  .transform((input) => ({
    ...input,
    targets: input.targets.map((target) => ({
      ...target,
      messageIds: [...new Set(target.messageIds)].toSorted(),
    })),
  }));
export type MailSnoozeApplyInput = z.infer<typeof mailSnoozeApplySchema>;

export const mailSnoozeStateSchema = z.strictObject({
  code: z.string().optional(),
  id: z.uuid(),
  mailboxId: sourceIdSchema,
  message: z.string().optional(),
  ...scheduleFields,
  status: mailSnoozeStatusSchema,
  threadId: sourceIdSchema,
  version: z.number().int().nonnegative(),
});
export type MailSnoozeState = z.infer<typeof mailSnoozeStateSchema>;

export const mailSnoozeTargetResultSchema = z.strictObject({
  code: z.string().optional(),
  message: z.string().optional(),
  messageIds: z.array(sourceIdSchema).optional(),
  operationId: z.uuid().optional(),
  placementOperationId: z.uuid().optional(),
  replayed: z.boolean().optional(),
  snooze: mailSnoozeStateSchema.optional(),
  status: z.enum(["applied", "failed"]),
  threadId: sourceIdSchema,
});
export type MailSnoozeTargetResult = z.infer<
  typeof mailSnoozeTargetResultSchema
>;

export const mailSnoozeResultSchema = z.strictObject({
  targets: z.array(mailSnoozeTargetResultSchema),
});
export type MailSnoozeResult = z.infer<typeof mailSnoozeResultSchema>;
