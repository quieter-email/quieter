import { describe, expect, test, vi } from "vite-plus/test";

import { createCalendarChatTools } from "../src/chat-agent";
import type { CalendarToolsContext } from "../src/chat-agent";

describe("calendar context tool", () => {
  test("reads without approval and forwards cancellation to the selected account", async () => {
    const listEvents = vi
      .fn<CalendarToolsContext["listEvents"]>()
      .mockResolvedValue({
        events: [],
        fetchedAt: "2026-10-23T12:00:00Z",
        status: "success",
      });
    const tools = createCalendarChatTools({
      createEvent: vi.fn<CalendarToolsContext["createEvent"]>(),
      deleteEvent: vi.fn<CalendarToolsContext["deleteEvent"]>(),
      getEvent: vi.fn<CalendarToolsContext["getEvent"]>(),
      listCalendars: vi.fn<CalendarToolsContext["listCalendars"]>(),
      listEvents,
      respondToEvent: vi.fn<CalendarToolsContext["respondToEvent"]>(),
      updateEvent: vi.fn<CalendarToolsContext["updateEvent"]>(),
    });
    const read = tools.list_calendar_events;
    if (!read?.execute) {
      throw new Error("Expected the calendar read tool");
    }
    const controller = new AbortController();
    const range = {
      calendarId: "team-calendar",
      connectionId: "connection-1",
      end: "2026-10-24T00:00:00Z",
      start: "2026-10-23T00:00:00Z",
      timeZone: "Europe/Berlin",
    };
    const result: unknown = await read.execute(range, {
      abortSignal: controller.signal,
      context: undefined,
      messages: [],
      toolCallId: "calendar",
    });
    expect(read).not.toHaveProperty("needsApproval");
    expect(listEvents).toHaveBeenCalledWith(range, controller.signal);
    expect(result).toMatchObject({ events: [], status: "success" });
    controller.abort();
    expect(listEvents.mock.calls[0]?.[1]?.aborted).toBeTruthy();
  });
});
