import {
  createReminderSchema,
  changeReminderSchema,
  listRemindersSchema,
  getReminderSchema,
  reminderSuggestionInputSchema,
  reminderSuggestionActionSchema,
  reminderPreferencesInputSchema,
  updateReminderPreferencesSchema,
} from "@quieter/mail/reminders";

import {
  createReminder,
  changeReminder,
  listReminders,
  getReminder,
} from "../reminders/service";
import {
  getReminderSuggestion,
  acceptReminderSuggestion,
  dismissReminderSuggestion,
  getReminderPreferences,
  updateReminderPreferences,
} from "../reminders/suggestions";
import { protectedProcedure } from "./base";

export const remindersRouter = {
  acceptSuggestion: protectedProcedure
    .input(reminderSuggestionActionSchema)
    .handler(
      async ({ context, input }) =>
        await acceptReminderSuggestion({ ...input, userId: context.userId })
    ),
  change: protectedProcedure
    .input(changeReminderSchema)
    .handler(
      async ({ context, input }) =>
        await changeReminder({ ...input, userId: context.userId })
    ),
  create: protectedProcedure
    .input(createReminderSchema)
    .handler(
      async ({ context, input }) =>
        await createReminder({ ...input, userId: context.userId })
    ),
  dismissSuggestion: protectedProcedure
    .input(reminderSuggestionActionSchema)
    .handler(async ({ context, input }) => {
      await dismissReminderSuggestion({ ...input, userId: context.userId });
    }),
  get: protectedProcedure
    .input(getReminderSchema)
    .handler(
      async ({ context, input }) =>
        await getReminder({ ...input, userId: context.userId })
    ),
  list: protectedProcedure
    .input(listRemindersSchema)
    .handler(
      async ({ context, input }) =>
        await listReminders({ ...input, userId: context.userId })
    ),
  preferences: protectedProcedure
    .input(reminderPreferencesInputSchema)
    .handler(
      async ({ context, input }) =>
        await getReminderPreferences({ ...input, userId: context.userId })
    ),
  suggestion: protectedProcedure
    .input(reminderSuggestionInputSchema)
    .handler(
      async ({ context, input }) =>
        await getReminderSuggestion({ ...input, userId: context.userId })
    ),
  updatePreferences: protectedProcedure
    .input(updateReminderPreferencesSchema)
    .handler(
      async ({ context, input }) =>
        await updateReminderPreferences({ ...input, userId: context.userId })
    ),
};
