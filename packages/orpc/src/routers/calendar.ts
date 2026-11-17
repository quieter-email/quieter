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
import {
  calendarAvailabilityInputSchema,
  calendarAvailabilityResultSchema,
} from "@quieter/calendar/availability";
import { z } from "zod";

import { proposeCalendarAvailabilityForUser } from "../calendar/availability";
import {
  calendarBookingCreateInputSchema,
  calendarBookingCreateResultSchema,
  calendarBookingLinkRefSchema,
  calendarBookingOwnerLinkSchema,
  calendarBookingOwnerListInputSchema,
  calendarBookingOwnerListSchema,
  calendarBookingResultInputSchema,
  calendarBookingResultSchema,
  calendarBookingViewInputSchema,
  calendarBookingViewSchema,
} from "../calendar/booking-contracts";
import {
  createCalendarBookingLinkForUser,
  listCalendarBookingLinksForUser,
  lookupCalendarBookingResult,
  revokeCalendarBookingLinkForUser,
  viewCalendarBooking,
} from "../calendar/bookings";
import { importCalendarInvitationAttachmentForUser } from "../calendar/invitation-import";
import {
  calendarProposalCreateInputSchema,
  createCalendarProposalEventForUser,
} from "../calendar/proposals";
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
import { mailboxIdSchema, protectedProcedure, publicProcedure } from "./base";

export const calendarRouter = {
  accounts: protectedProcedure
    .route({ method: "GET" })
    .output(
      z.object({
        accounts: z.array(calendarAccountSchema),
        googleConfigured: z.boolean(),
        isConfigured: z.boolean(),
        microsoftConfigured: z.boolean(),
      })
    )
    .handler(
      async ({ context }) =>
        await listCalendarAccountsForUser({
          signal: context.signal,
          userId: context.userId,
        })
    ),

  availability: protectedProcedure
    .input(calendarAvailabilityInputSchema)
    .output(calendarAvailabilityResultSchema)
    .handler(
      async ({ context, input }) =>
        await proposeCalendarAvailabilityForUser({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  bookingLinks: protectedProcedure
    .route({ method: "GET" })
    .input(calendarBookingOwnerListInputSchema)
    .output(calendarBookingOwnerListSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await listCalendarBookingLinksForUser({
        ...input,
        signal: context.signal,
        userId: context.userId,
      });
    }),

  bookingResult: publicProcedure
    .route({ method: "POST" })
    .input(calendarBookingResultInputSchema)
    .output(calendarBookingResultSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await lookupCalendarBookingResult({
        ...input,
        signal: context.signal,
      });
    }),

  bookingView: publicProcedure
    .route({ method: "POST" })
    .input(calendarBookingViewInputSchema)
    .output(calendarBookingViewSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await viewCalendarBooking({ ...input, signal: context.signal });
    }),

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

  createBookingLink: protectedProcedure
    .input(calendarBookingCreateInputSchema)
    .output(calendarBookingCreateResultSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await createCalendarBookingLinkForUser({
        ...input,
        signal: context.signal,
        userId: context.userId,
      });
    }),

  createFromProposal: protectedProcedure
    .input(calendarProposalCreateInputSchema)
    .output(calendarMutationResultSchema)
    .handler(
      async ({ context, input }) =>
        await createCalendarProposalEventForUser({
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

  revokeBookingLink: protectedProcedure
    .input(calendarBookingLinkRefSchema)
    .output(calendarBookingOwnerLinkSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await revokeCalendarBookingLinkForUser({
        ...input,
        signal: context.signal,
        userId: context.userId,
      });
    }),

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
