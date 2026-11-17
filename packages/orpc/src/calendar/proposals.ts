import { ORPCError } from "@orpc/server";
import { calendarCreateInputSchema } from "@quieter/calendar";
import { calendarAvailabilityInputSchema } from "@quieter/calendar/availability";
import { z } from "zod";

import { assertAccessibleMailbox } from "../mailbox/service";
import { proposeCalendarAvailabilityForUser } from "./availability";
import { createCalendarEventForUser } from "./service";

export const calendarProposalCreateInputSchema = calendarCreateInputSchema
  .extend({
    availability: calendarAvailabilityInputSchema,
    event: calendarCreateInputSchema.shape.event.extend({
      recurrence: calendarCreateInputSchema.shape.event.shape.recurrence
        .unwrap()
        .max(0, "Create a one-off meeting from a proposed time.")
        .default([]),
      time: calendarCreateInputSchema.shape.event.shape.time.options[1].refine(
        (time) => !/\.\d{4}/u.test(time.start) && !/\.\d{4}/u.test(time.end),
        "Choose a meeting time with millisecond precision or less."
      ),
    }),
    mailboxId: z.string().trim().min(1).max(1024),
  })
  .refine(
    (input) =>
      input.availability.calendars.some(
        (calendar) =>
          calendar.calendarId === input.calendarId &&
          calendar.connectionId === input.connectionId
      ),
    {
      message:
        "Choose a destination from the calendars checked for availability.",
      path: ["calendarId"],
    }
  )
  .refine(
    (input) =>
      Date.parse(input.event.time.end) - Date.parse(input.event.time.start) ===
      input.availability.preferences.durationMinutes * 60_000,
    {
      message: "The meeting must match the requested duration.",
      path: ["event", "time", "end"],
    }
  );

export const createCalendarProposalEventForUser = async (
  input: z.infer<typeof calendarProposalCreateInputSchema> & {
    signal?: AbortSignal;
    userId: string;
  }
) => {
  await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const start = Date.parse(input.event.time.start);
  const end = Date.parse(input.event.time.end);
  if (start <= Date.now()) {
    throw new ORPCError("CONFLICT", {
      message: "This time has passed. Choose a future time and try again.",
    });
  }
  const availability = await proposeCalendarAvailabilityForUser({
    ...input.availability,
    end: input.event.time.end,
    limit: 1,
    signal: input.signal,
    start: input.event.time.start,
    userId: input.userId,
  });
  for (const source of availability.coverage) {
    if (source.status !== "unavailable") {
      continue;
    }
    switch (source.reason) {
      case "reconnect": {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Reconnect the selected calendar accounts and try again.",
        });
      }
      case "permission": {
        throw new ORPCError("FORBIDDEN", {
          message:
            "Access to a selected calendar changed. Review calendar permissions and try again.",
        });
      }
      case "not-found": {
        throw new ORPCError("CONFLICT", {
          message:
            "A selected calendar is no longer available. Choose your calendars again before creating the meeting.",
        });
      }
      case "temporary": {
        throw new ORPCError("CONFLICT", {
          message:
            "A selected calendar could not be checked. Retry before creating the meeting.",
        });
      }
      case "unsupported": {
        throw new ORPCError("CONFLICT", {
          message:
            "A selected calendar could not be checked for this time. Review your selected calendars before trying again.",
        });
      }
      default: {
        const exhaustive: never = source.reason;
        throw new Error("Unknown calendar coverage failure.", {
          cause: exhaustive,
        });
      }
    }
  }
  if (
    availability.status !== "complete" ||
    start <= Date.now() ||
    !availability.candidates.some(
      (candidate) =>
        Date.parse(candidate.start) === start &&
        Date.parse(candidate.end) === end
    )
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "This time is no longer available. Refresh the proposed times and choose another meeting time.",
    });
  }
  return await createCalendarEventForUser({
    calendarId: input.calendarId,
    connectionId: input.connectionId,
    event: input.event,
    operationId: input.operationId,
    signal: input.signal,
    userId: input.userId,
  });
};
