import { describe, expect, test, vi } from "vite-plus/test";

import { createGoogleCalendarChatTool } from "../src/chat-agent";
import type { GoogleCalendarToolsContext } from "../src/chat-agent";

describe("calendar context tool", () => {
  test("reads without approval and forwards cancellation to the connected account", async () => {
    const listGoogleCalendarEvents = vi
      .fn<GoogleCalendarToolsContext["listGoogleCalendarEvents"]>()
      .mockResolvedValue({
        calendarId: "primary",
        currentDate: "2026-10-23",
        events: [],
        fetchedAt: "2026-10-23T12:00:00Z",
        partial: false,
        status: "success",
        timeMax: "2026-10-24T00:00:00Z",
        timeMin: "2026-10-23T00:00:00Z",
        timeZone: "Europe/Berlin",
      });
    const tools = createGoogleCalendarChatTool({
      createGoogleCalendarEvent:
        vi.fn<GoogleCalendarToolsContext["createGoogleCalendarEvent"]>(),
      listGoogleCalendarEvents,
    });
    const read = tools.list_google_calendar_events;
    if (!read?.execute) {
      throw new Error("Expected the calendar read tool");
    }
    const abortSignal = new AbortController().signal;
    const range = {
      maxResults: 2,
      timeMax: "2026-10-24T00:00:00Z",
      timeMin: "2026-10-23T00:00:00Z",
    };
    const result: unknown = await read.execute(range, {
      abortSignal,
      context: undefined,
      messages: [],
      toolCallId: "calendar",
    });
    expect(read).not.toHaveProperty("needsApproval");
    expect(listGoogleCalendarEvents).toHaveBeenCalledWith(range, abortSignal);
    expect(result).toMatchObject({
      events: [],
      status: "success",
      timeZone: "Europe/Berlin",
    });

    const cancelled = new AbortController();
    cancelled.abort();
    listGoogleCalendarEvents.mockClear();
    await expect(
      read.execute(range, {
        abortSignal: cancelled.signal,
        context: undefined,
        messages: [],
        toolCallId: "cancelled-calendar",
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(listGoogleCalendarEvents).not.toHaveBeenCalled();
  });
});
