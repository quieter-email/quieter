import { ORPCError } from "@orpc/server";
import { calendarToolErrorSchema } from "@quieter/ai/chat-tools";
import {
  calendarAvailabilityInputSchema,
  calendarAvailabilityResultSchema,
} from "@quieter/calendar/availability";
import { reportError } from "@quieter/observability";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { proposeCalendarAvailabilityForUser } from "../calendar/availability";

export const createSchedulingTools = ({
  userId,
}: {
  userId: string;
}): ToolSet => ({
  list_calendar_availability: tool({
    description:
      "Find bounded meeting times using the signed-in user's explicitly selected calendars and working preferences. First discover the user's connected calendar IDs. No event is created, no slot is reserved, and other people's availability is not checked. Preserve the timezone and coverage explanation when proposing times in a reply. Incomplete coverage returns no candidates. Inserting wording uses the ordinary reviewed reply path; creating an agreed event requires a separate explicit review and fresh availability check.",
    execute: async (input, { abortSignal }) => {
      try {
        return await proposeCalendarAvailabilityForUser({
          ...input,
          signal: abortSignal,
          userId,
        });
      } catch (error) {
        abortSignal?.throwIfAborted();
        if (error instanceof ORPCError && error.status < 500) {
          return { error: error.message, status: "error" as const };
        }
        reportError(error, { operation: "chat:calendar-availability" });
        return {
          error: "Calendar availability could not be checked. Try again.",
          status: "error" as const,
        };
      }
    },
    inputSchema: calendarAvailabilityInputSchema,
    outputSchema: z.union([
      calendarAvailabilityResultSchema,
      calendarToolErrorSchema,
    ]),
  }),
});
