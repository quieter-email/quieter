import { ORPCError } from "@orpc/server";
import type {
  CalendarAvailabilityInput,
  CalendarAvailabilityResult,
  CalendarAvailabilitySnapshot,
} from "@quieter/calendar/availability";
import { calculateCalendarAvailability } from "@quieter/calendar/availability";
import { reportError } from "@quieter/observability";

import { listCalendarEventsForUser, listCalendarsForUser } from "./service";

export const proposeCalendarAvailabilityForUser = async (
  input: CalendarAvailabilityInput & {
    signal?: AbortSignal;
    userId: string;
  }
): Promise<CalendarAvailabilityResult> => {
  input.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(25_000);
  const signal = input.signal
    ? AbortSignal.any([input.signal, deadline])
    : deadline;
  const coverage: CalendarAvailabilityResult["coverage"] = [];
  const calendars: CalendarAvailabilitySnapshot[] = [];
  const buffer =
    Math.max(
      input.preferences.bufferBeforeMinutes,
      input.preferences.bufferAfterMinutes
    ) * 60_000;
  const start = new Date(Date.parse(input.start) - buffer).toISOString();
  const end = new Date(Date.parse(input.end) + buffer).toISOString();
  for (const calendar of input.calendars) {
    try {
      signal.throwIfAborted();
      const request = { ...calendar, signal, userId: input.userId };
      const available = await listCalendarsForUser(request);
      const selected = available.calendars.find(
        (candidate) =>
          candidate.calendarId === calendar.calendarId ||
          (calendar.calendarId === "primary" && candidate.primary)
      );
      if (!selected) {
        throw new ORPCError("NOT_FOUND");
      }
      const { events } = await listCalendarEventsForUser({
        ...request,
        calendarId: selected.calendarId,
        end,
        start,
        timeZone: input.timeZone,
      });
      if (
        events.some(
          (event) =>
            event.time.kind === "all-day" && event.time.timeZone === undefined
        )
      ) {
        throw new ORPCError("BAD_REQUEST");
      }
      calendars.push({ calendar: selected, events });
      coverage.push({ calendar, status: "complete" });
    } catch (error) {
      input.signal?.throwIfAborted();
      let reason: Extract<
        CalendarAvailabilityResult["coverage"][number],
        { status: "unavailable" }
      >["reason"] = "temporary";
      if (error instanceof ORPCError) {
        switch (error.code) {
          case "UNAUTHORIZED": {
            reason = "reconnect";
            break;
          }
          case "FORBIDDEN": {
            reason = "permission";
            break;
          }
          case "NOT_FOUND": {
            reason = "not-found";
            break;
          }
          case "BAD_REQUEST": {
            reason = "unsupported";
            break;
          }
          default: {
            if (error.status >= 500) {
              reportError(error, { operation: "calendar:availability" });
            }
          }
        }
      } else if (!deadline.aborted) {
        reportError(error, { operation: "calendar:availability" });
      }
      coverage.push({ calendar, reason, status: "unavailable" });
    }
  }
  let status: CalendarAvailabilityResult["status"] = "partial";
  if (calendars.length === input.calendars.length) {
    status = "complete";
  } else if (calendars.length === 0) {
    status = "unavailable";
  }
  return {
    candidates:
      status === "complete"
        ? calculateCalendarAvailability({ calendars, input })
        : [],
    checkedAt: new Date().toISOString(),
    coverage,
    explanation:
      status === "complete"
        ? "These times fit your selected calendars and working hours. Other people's availability has not been checked. Recheck before creating an event."
        : "Some selected calendars could not be checked. Reconnect the account, review calendar access, or retry with a shorter range before proposing times. Other people's availability has not been checked.",
    status,
    timeZone: input.timeZone,
  };
};
