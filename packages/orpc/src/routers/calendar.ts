import {
  calendarAccountSchema,
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
} from "@quieter/calendar";
import { z } from "zod";

import {
  createCalendarEventForUser,
  deleteCalendarEventForUser,
  getCalendarEventForUser,
  listCalendarAccountsForUser,
  listCalendarEventsForUser,
  listCalendarsForUser,
  respondToCalendarEventForUser,
  updateCalendarEventForUser,
} from "../calendar/service";
import { protectedProcedure } from "./base";

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
};
