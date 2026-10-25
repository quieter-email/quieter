import { ORPCError } from "@orpc/server";
import type { CalendarToolsContext } from "@quieter/ai/chat-agent";
import {
  calendarWriteInputSchemas,
  resolveCalendarWriteReview,
} from "@quieter/ai/chat-tools";
import type {
  CalendarWriteToolName,
  ForegroundSnapshot,
} from "@quieter/ai/chat-tools";
import { reportError } from "@quieter/observability";
import { isToolUIPart } from "ai";
import type { UIMessage } from "ai";

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

export const assertCalendarToolApproval = ({
  foreground,
  input,
  toolCallId,
  toolName,
  transcript,
}: {
  foreground: ForegroundSnapshot;
  input: unknown;
  toolCallId: string;
  toolName: CalendarWriteToolName;
  transcript: readonly UIMessage[];
}) => {
  const message = transcript.findLast(
    (candidate) =>
      candidate.id === foreground.exchangeId && candidate.role === "assistant"
  );
  const approvedCall = message?.parts.find(
    (part) =>
      isToolUIPart(part) &&
      part.type === `tool-${toolName}` &&
      part.toolCallId === toolCallId
  );
  if (
    approvedCall === undefined ||
    !isToolUIPart(approvedCall) ||
    approvedCall.state !== "approval-responded" ||
    !approvedCall.approval.approved
  ) {
    throw new ORPCError("CONFLICT", {
      message: "Approve the exact calendar change before continuing.",
    });
  }
  const schema = calendarWriteInputSchemas[toolName];
  const approved = schema.safeParse(approvedCall.input);
  const proposed = schema.safeParse(input);
  if (
    !approved.success ||
    !proposed.success ||
    JSON.stringify(approved.data) !== JSON.stringify(proposed.data)
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "The calendar change differs from the approved action. Review it again.",
    });
  }
  if (
    message === undefined ||
    resolveCalendarWriteReview({
      input: proposed.data,
      toolName,
      transcript: [message],
    }) === undefined
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "Read the destination calendar and current event before requesting approval again.",
    });
  }
};

export const deriveCalendarToolOperationId = async ({
  exchangeId,
  toolCallId,
  userId,
}: {
  exchangeId: string;
  toolCallId: string;
  userId: string;
}) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([userId, exchangeId, toolCallId]))
    )
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) % 16) + 128;
  bytes[8] = ((bytes[8] ?? 0) % 64) + 128;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const runCalendarTool = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
) => {
  const timeout = AbortSignal.timeout(25_000);
  try {
    signal?.throwIfAborted();
    return await operation(
      signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    );
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    if (error instanceof ORPCError && error.status < 500) {
      return { error: error.message, status: "error" as const };
    }
    reportError(error, { operation: "chat:calendar-tool" });
    return {
      error: timeout.aborted
        ? "The calendar took too long to respond. Retry with a smaller date range."
        : "The calendar action could not be completed. Try again.",
      status: "error" as const,
    };
  }
};

export const createCalendarToolsContext = ({
  foreground,
  transcript,
  userId,
}: {
  foreground: ForegroundSnapshot;
  transcript: readonly UIMessage[];
  userId: string;
}): CalendarToolsContext => ({
  createEvent: async (input, { signal, toolCallId }) =>
    await runCalendarTool(async (runSignal) => {
      assertCalendarToolApproval({
        foreground,
        input,
        toolCallId,
        toolName: "create_calendar_event",
        transcript,
      });
      const operationId = await deriveCalendarToolOperationId({
        exchangeId: foreground.exchangeId,
        toolCallId,
        userId,
      });
      return await createCalendarEventForUser({
        ...input,
        operationId,
        signal: runSignal,
        userId,
      });
    }, signal),
  deleteEvent: async (input, { signal, toolCallId }) =>
    await runCalendarTool(async (runSignal) => {
      assertCalendarToolApproval({
        foreground,
        input,
        toolCallId,
        toolName: "delete_calendar_event",
        transcript,
      });
      return await deleteCalendarEventForUser({
        ...input,
        signal: runSignal,
        userId,
      });
    }, signal),
  getEvent: async (input, signal) =>
    await runCalendarTool(
      async (runSignal) => ({
        event: await getCalendarEventForUser({
          ...input,
          signal: runSignal,
          userId,
        }),
        fetchedAt: new Date().toISOString(),
        status: "success" as const,
      }),
      signal
    ),
  listCalendars: async ({ connectionId }, signal) =>
    await runCalendarTool(async (runSignal) => {
      const accounts = await listCalendarAccountsForUser({ userId });
      const listed =
        connectionId === undefined
          ? { calendars: [] }
          : await listCalendarsForUser({
              connectionId,
              signal: runSignal,
              userId,
            });
      return {
        accounts: accounts.accounts,
        calendars: listed.calendars,
        fetchedAt: new Date().toISOString(),
        status: "success" as const,
      };
    }, signal),
  listEvents: async (input, signal) =>
    await runCalendarTool(async (runSignal) => {
      const result = await listCalendarEventsForUser({
        ...input,
        signal: runSignal,
        userId,
      });
      return {
        events: result.events,
        fetchedAt: new Date().toISOString(),
        status: "success" as const,
      };
    }, signal),
  respondToEvent: async (input, { signal, toolCallId }) =>
    await runCalendarTool(async (runSignal) => {
      assertCalendarToolApproval({
        foreground,
        input,
        toolCallId,
        toolName: "respond_to_calendar_event",
        transcript,
      });
      return await respondToCalendarEventForUser({
        ...input,
        signal: runSignal,
        userId,
      });
    }, signal),
  updateEvent: async (input, { signal, toolCallId }) =>
    await runCalendarTool(async (runSignal) => {
      assertCalendarToolApproval({
        foreground,
        input,
        toolCallId,
        toolName: "update_calendar_event",
        transcript,
      });
      return await updateCalendarEventForUser({
        ...input,
        signal: runSignal,
        userId,
      });
    }, signal),
});
