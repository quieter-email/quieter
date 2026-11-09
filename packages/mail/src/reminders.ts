import { z } from "zod";

export const reminderTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");
export const reminderDueAtSchema = z.iso.datetime({ offset: true });
export const reminderTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("standalone") }),
  z.strictObject({
    anchorMessageId: z.string().min(1).max(512),
    condition: z.string().trim().min(1).max(2000).nullable(),
    kind: z.literal("thread"),
    threadId: z.string().min(1).max(512),
  }),
]);
const reminderFields = {
  dueAt: reminderDueAtSchema,
  target: reminderTargetSchema,
  timeZone: reminderTimeZoneSchema,
  title: z.string().trim().min(1).max(240),
};
export const createReminderSchema = z.strictObject({
  mailboxId: z.string().min(1),
  requestId: z.uuid(),
  ...reminderFields,
});
export const changeReminderSchema = z.strictObject({
  command: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("edit"), ...reminderFields }),
    z.strictObject({
      dueAt: reminderDueAtSchema,
      kind: z.literal("snooze"),
      timeZone: reminderTimeZoneSchema,
    }),
    z.strictObject({ kind: z.literal("complete") }),
    z.strictObject({ kind: z.literal("cancel") }),
    z.strictObject({ kind: z.literal("reactivate") }),
  ]),
  expectedVersion: z.number().int().positive(),
  mailboxId: z.string().min(1),
  reminderId: z.uuid(),
});
export const listRemindersSchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  mailboxId: z.string().min(1),
  view: z.enum(["active", "history"]),
});
export const getReminderSchema = z.strictObject({
  mailboxId: z.string().min(1),
  reminderId: z.uuid(),
});
export const reminderSourceSchema = z.strictObject({
  kind: z.enum(["suggestion", "automatic"]),
  messageId: z.string().min(1),
  reason: z.string().min(1).max(1000),
});
export const reminderSuggestionInputSchema = z.strictObject({
  mailboxId: z.string().min(1),
  messageId: z.string().min(1).max(512),
  threadId: z.string().min(1).max(512),
  timeZone: reminderTimeZoneSchema,
});
export const reminderSuggestionActionSchema = z.strictObject({
  mailboxId: z.string().min(1),
  suggestionId: z.uuid(),
});
export const reminderPreferencesInputSchema = z.strictObject({
  mailboxId: z.string().min(1),
});
export const updateReminderPreferencesSchema = z.strictObject({
  automatic: z.boolean(),
  mailboxId: z.string().min(1),
  suggestions: z.boolean(),
  timeZone: reminderTimeZoneSchema,
});
export const reminderSuggestionSchema = z.strictObject({
  condition: z.string().min(1).max(2000).nullable(),
  confidence: z.enum(["clear", "uncertain"]),
  dueAt: reminderDueAtSchema,
  id: z.uuid(),
  mailboxId: z.string(),
  messageId: z.string(),
  reason: z.string().min(1).max(1000),
  reminderId: z.uuid().nullable(),
  status: z.enum(["suggested", "accepted", "dismissed"]),
  threadId: z.string(),
  timeZone: reminderTimeZoneSchema,
  title: reminderFields.title,
});
export type ReminderSuggestion = z.infer<typeof reminderSuggestionSchema>;
export type ReminderSource = z.infer<typeof reminderSourceSchema>;
export const reminderSchema = z.strictObject({
  ...reminderFields,
  createdAt: z.string(),
  evaluationStatus: z.enum([
    "none",
    "pending",
    "unfulfilled",
    "uncertain",
    "fulfilled",
    "failed",
  ]),
  evaluationSummary: z.string().nullable(),
  firedAt: z.string().nullable(),
  id: z.uuid(),
  mailboxId: z.string(),
  resolution: z.string().nullable(),
  scheduleVersion: z.number().int().positive(),
  source: reminderSourceSchema.nullable(),
  status: z.enum(["active", "completed", "cancelled", "suspended"]),
  updatedAt: z.string(),
  version: z.number().int().positive(),
});
export const followUpReminderIntentSchema = z.strictObject({
  condition: z.string().trim().min(1).max(2000),
  dueAt: reminderDueAtSchema,
  requestId: z.uuid(),
  timeZone: reminderTimeZoneSchema,
  title: reminderFields.title,
});
export const reminderWakeSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  mailboxId: z.string().min(1),
  purpose: z.literal("reminder-wake"),
  userId: z.string().min(1),
});
export type Reminder = z.infer<typeof reminderSchema>;
export type ReminderTarget = z.infer<typeof reminderTargetSchema>;
export type CreateReminder = z.infer<typeof createReminderSchema>;
export type ChangeReminder = z.infer<typeof changeReminderSchema>;
export type FollowUpReminderIntent = z.infer<
  typeof followUpReminderIntentSchema
>;
