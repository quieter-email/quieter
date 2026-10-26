import {
  calendarAccountSchema,
  calendarColorSchema,
  calendarCreateInputSchema,
  calendarDeleteInputSchema,
  calendarEventRefSchema,
  calendarEventSchema,
  calendarEventsInputSchema,
  calendarMutationResultSchema,
  calendarRefSchema,
  calendarRespondInputSchema,
  calendarSummarySchema,
  calendarUpdateInputSchema,
  calendarUpdateColorInputSchema,
} from "@quieter/calendar";
import { z } from "zod";

import { importCalendarInvitationAttachmentForUser } from "../calendar/invitation-import";
import {
  createCalendarEventForUser,
  deleteCalendarEventForUser,
  getCalendarEventForUser,
  listCalendarAccountsForUser,
  listCalendarEventsForUser,
  listCalendarColorsForUser,
  listCalendarsForUser,
  respondToCalendarEventForUser,
  updateCalendarEventForUser,
  updateCalendarColorForUser,
} from "../calendar/service";
import { mailboxIdSchema, protectedProcedure } from "./base";

export const calendarRouter = {
  accounts: protectedProcedure
    .route({ method: "GET" })
    .output(
      z.object({
        accounts: z.array(calendarAccountSchema),
        isConfigured: z.boolean(),
      })
    )
    .handler(
      async ({ context }) =>
        await listCalendarAccountsForUser({
          signal: context.signal,
          userId: context.userId,
        })
    ),

  calendars: protectedProcedure
    .input(calendarRefSchema.pick({ connectionId: true }))
    .output(z.object({ calendars: z.array(calendarSummarySchema) }))
    .handler(
      async ({ context, input }) =>
        await listCalendarsForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  colors: protectedProcedure
    .input(calendarRefSchema.pick({ connectionId: true }))
    .output(z.object({ colors: z.array(calendarColorSchema) }))
    .handler(
      async ({ context, input }) =>
        await listCalendarColorsForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  create: protectedProcedure
    .input(calendarCreateInputSchema)
    .output(calendarMutationResultSchema)
    .handler(
      async ({ context, input }) =>
        await createCalendarEventForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  delete: protectedProcedure
    .input(calendarDeleteInputSchema)
    .output(calendarMutationResultSchema)
    .handler(
      async ({ context, input }) =>
        await deleteCalendarEventForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  event: protectedProcedure
    .input(calendarEventRefSchema)
    .output(calendarEventSchema)
    .handler(
      async ({ context, input }) =>
        await getCalendarEventForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  events: protectedProcedure
    .input(calendarEventsInputSchema)
    .output(z.object({ events: z.array(calendarEventSchema) }))
    .handler(
      async ({ context, input }) =>
        await listCalendarEventsForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  importInvitation: protectedProcedure
    .input(
      z.object({
        attachmentId: z.string().trim().min(1),
        calendarId: z.string().trim().min(1).optional(),
        connectionId: z.string().trim().min(1).optional(),
        mailboxId: mailboxIdSchema,
        messageId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await importCalendarInvitationAttachmentForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  respond: protectedProcedure
    .input(calendarRespondInputSchema)
    .output(calendarMutationResultSchema)
    .handler(
      async ({ context, input }) =>
        await respondToCalendarEventForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  update: protectedProcedure
    .input(calendarUpdateInputSchema)
    .output(calendarMutationResultSchema)
    .handler(
      async ({ context, input }) =>
        await updateCalendarEventForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  updateColor: protectedProcedure
    .input(calendarUpdateColorInputSchema)
    .output(calendarSummarySchema)
    .handler(
      async ({ context, input }) =>
        await updateCalendarColorForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),
};
