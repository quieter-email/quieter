import {
  calendarEventQueryOptions,
  calendarEventsQueryOptions,
} from "@quieter/app/lib/calendar-query";
import { rpc } from "@quieter/app/lib/orpc";
import {
  calendarEventRefSchema,
  calendarEventSchema,
  calendarEventsInputSchema,
  calendarSummarySchema,
} from "@quieter/calendar";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    rpc: {
      ...original.rpc,
      calendar: {
        ...original.rpc.calendar,
        event: vi.fn<typeof rpc.calendar.event>(),
        events: vi.fn<typeof rpc.calendar.events>(),
      },
    },
  };
});

const calendar = calendarSummarySchema.parse({
  access: "owner",
  calendarId: "primary",
  color: "#4285f4",
  connectionId: "work",
  name: "Work schedule",
  primary: true,
  selected: true,
  supportsMeetings: true,
  timeZone: "Europe/Berlin",
});
const meeting = calendarEventSchema.parse({
  attendees: [],
  availability: "busy",
  calendarId: "primary",
  connectionId: "work",
  description: "Bring the roadmap",
  eventId: "planning",
  location: "Studio",
  meetingPending: false,
  meetingUrl: "https://meet.example.com/planning",
  organizer: { email: "organizer@example.com", self: true },
  permissions: { delete: true, edit: true, respond: false },
  recurrence: [],
  reminders: { kind: "default" },
  status: "confirmed",
  time: {
    end: "2026-10-26T11:00:00+01:00",
    kind: "timed",
    start: "2026-10-26T10:00:00+01:00",
    timeZone: "Europe/Berlin",
  },
  title: "Planning",
  version: "current",
  visibility: "private",
  webUrl: "https://calendar.example.com/events/planning",
});

describe("calendar query transport", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  test("loads events for a complete calendar summary", async () => {
    vi.mocked(rpc.calendar.events).mockImplementation(async (input) => {
      await calendarEventsInputSchema.parseAsync(input);
      return { events: [meeting] };
    });

    await expect(
      queryClient.query(
        calendarEventsQueryOptions("user", calendar, {
          end: "2026-11-01T00:00:00+01:00",
          query: "planning",
          start: "2026-10-01T00:00:00+02:00",
          timeZone: "Europe/Berlin",
        })
      )
    ).resolves.toMatchObject({
      events: [{ eventId: "planning", title: "Planning" }],
    });
  });

  test("loads event details from a complete event", async () => {
    vi.mocked(rpc.calendar.event).mockImplementation(async (input) => {
      await calendarEventRefSchema.parseAsync(input);
      return meeting;
    });

    await expect(
      queryClient.query(calendarEventQueryOptions("user", meeting))
    ).resolves.toMatchObject({
      eventId: "planning",
      meetingUrl: "https://meet.example.com/planning",
      title: "Planning",
    });
  });
});
