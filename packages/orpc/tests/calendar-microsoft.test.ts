/* oxlint-disable eslint/require-await -- Fetch mocks preserve the asynchronous transport contract. */
import type { CalendarEventTime } from "@quieter/calendar";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { updateMicrosoftCalendarEventForUser } from "../src/calendar/microsoft";
import { microsoftRecurrenceSchema } from "../src/calendar/microsoft-recurrence";

vi.mock(import("../src/connectors/runtime"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAuthorizedConnector: async <T>(
      _input: Parameters<typeof actual.runAuthorizedConnector>[0],
      run: (token: string) => Promise<T>
    ): Promise<T> => await run("owned-test-token"),
  };
});

const reference = {
  calendarId: "calendar-1",
  connectionId: "connection-1",
  eventId: "series-1",
  userId: "owner-1",
};
const event = {
  "@odata.etag": '"version-1"',
  attendees: [],
  end: { dateTime: "2026-11-04T10:00:00", timeZone: "UTC" },
  id: reference.eventId,
  isAllDay: false,
  isOrganizer: true,
  originalStartTimeZone: "W. Europe Standard Time",
  recurrence: microsoftRecurrenceSchema.nullable().parse({
    pattern: { interval: 2, type: "daily" },
    range: {
      recurrenceTimeZone: "W. Europe Standard Time",
      startDate: "2026-11-04",
      type: "noEnd",
    },
  }),
  start: { dateTime: "2026-11-04T09:00:00", timeZone: "UTC" },
  subject: "Planning",
};

const mockCalendarEvent = (
  current: typeof event & { seriesMasterId?: string }
) => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(
        new URL(new Request(url).url).pathname.endsWith("/calendar-1")
          ? { canEdit: true, id: reference.calendarId, name: "Calendar" }
          : current
      )
    );
  vi.stubGlobal("fetch", request);
  return request;
};

const ranges = microsoftRecurrenceSchema.shape.range.array().parse([
  {
    endDate: "2026-12-18",
    startDate: "2026-11-04",
    type: "endDate",
  },
  {
    numberOfOccurrences: 12,
    startDate: "2026-11-04",
    type: "numbered",
  },
  { startDate: "2026-11-04", type: "noEnd" },
]);
const times: {
  current: typeof event;
  kind: string;
  time: CalendarEventTime;
  expectedStart: string;
  expectedZone: string;
}[] = [
  {
    current: event,
    expectedStart: "2026-11-06T00:30:00",
    expectedZone: "Asia/Tokyo",
    kind: "timed",
    time: {
      end: "2026-11-05T16:30:00Z",
      kind: "timed",
      start: "2026-11-05T15:30:00Z",
      timeZone: "Asia/Tokyo",
    },
  },
  {
    current: {
      ...event,
      end: {
        dateTime: "2026-11-05T00:00:00",
        timeZone: "W. Europe Standard Time",
      },
      isAllDay: true,
      start: {
        dateTime: "2026-11-04T00:00:00",
        timeZone: "W. Europe Standard Time",
      },
    },
    expectedStart: "2026-11-06T00:00:00",
    expectedZone: "W. Europe Standard Time",
    kind: "all-day",
    time: {
      endDate: "2026-11-07",
      kind: "all-day",
      startDate: "2026-11-06",
    },
  },
];

describe("Microsoft calendar series edits", () => {
  afterEach(() => vi.unstubAllGlobals());

  test.each(
    times.flatMap((time) => ranges.map((range) => ({ ...time, range })))
  )(
    "retains a $kind series' $range.type ending on a time-only edit",
    async ({ current, expectedStart, expectedZone, range, time }) => {
      const request = mockCalendarEvent({
        ...current,
        recurrence: {
          pattern: { interval: 2, type: "daily" },
          range: { ...range, recurrenceTimeZone: event.originalStartTimeZone },
        },
      });
      await expect(
        updateMicrosoftCalendarEventForUser({
          ...reference,
          changes: { time },
          version: event["@odata.etag"],
        })
      ).resolves.toMatchObject({ action: "updated" });
      const mutation = request.mock.calls.find(
        ([, init]) => init?.method === "PATCH"
      );
      expect(JSON.parse(z.string().parse(mutation?.[1]?.body))).toMatchObject({
        isAllDay: time.kind === "all-day",
        recurrence: {
          pattern: { interval: 2, type: "daily" },
          range: {
            ...range,
            recurrenceTimeZone: expectedZone,
            startDate: "2026-11-06",
          },
        },
        start: { dateTime: expectedStart, timeZone: expectedZone },
      });
    }
  );

  test.each([
    {
      date: "2026-11-04",
      end: "2026-11-04T12:00:00Z",
      start: "2026-11-04T11:00:00Z",
    },
    {
      date: "2026-11-05",
      end: "2026-11-05T12:00:00Z",
      start: "2026-11-05T11:00:00Z",
    },
  ])(
    "keeps explicit weekly days when changing the series time on $date",
    async ({ date, end, start }) => {
      const request = mockCalendarEvent({
        ...event,
        recurrence: {
          pattern: {
            daysOfWeek: ["wednesday", "friday"],
            firstDayOfWeek: "sunday",
            interval: 2,
            type: "weekly",
          },
          range: { startDate: "2026-11-04", type: "noEnd" },
        },
      });
      await updateMicrosoftCalendarEventForUser({
        ...reference,
        changes: {
          time: {
            end,
            kind: "timed",
            start,
            timeZone: "Europe/Berlin",
          },
        },
        version: event["@odata.etag"],
      });
      const mutation = request.mock.calls.find(
        ([, init]) => init?.method === "PATCH"
      );
      expect(JSON.parse(z.string().parse(mutation?.[1]?.body))).toMatchObject({
        recurrence: {
          pattern: {
            daysOfWeek: ["wednesday", "friday"],
            firstDayOfWeek: "sunday",
            interval: 2,
            type: "weekly",
          },
          range: { startDate: date, type: "noEnd" },
        },
      });
    }
  );

  test.each([
    { expected: null, recurrence: [] },
    {
      expected: {
        pattern: { daysOfWeek: ["monday"], type: "weekly" },
        range: { numberOfOccurrences: 5, type: "numbered" },
      },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5"],
    },
  ])(
    "honors an explicitly changed repeat rule with the new time",
    async ({ expected, recurrence }) => {
      const request = mockCalendarEvent(event);
      await updateMicrosoftCalendarEventForUser({
        ...reference,
        changes: {
          recurrence,
          time: {
            end: "2026-11-04T12:00:00Z",
            kind: "timed",
            start: "2026-11-04T11:00:00Z",
            timeZone: "Europe/Berlin",
          },
        },
        version: event["@odata.etag"],
      });
      const mutation = request.mock.calls.find(
        ([, init]) => init?.method === "PATCH"
      );
      expect(JSON.parse(z.string().parse(mutation?.[1]?.body))).toMatchObject({
        recurrence: expected,
      });
    }
  );

  test("rejects a skipped-date repeat rule without sending a mutation", async () => {
    const request = mockCalendarEvent(event);
    await expect(
      updateMicrosoftCalendarEventForUser({
        ...reference,
        changes: {
          recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3"],
          time: {
            endDate: "2026-02-01",
            kind: "all-day",
            startDate: "2026-01-31",
          },
        },
        version: event["@odata.etag"],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      request.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBeFalsy();
  });

  test("keeps the native month-end pattern when only its time changes", async () => {
    const request = mockCalendarEvent({
      ...event,
      recurrence: {
        pattern: { dayOfMonth: 31, interval: 1, type: "absoluteMonthly" },
        range: { startDate: "2026-01-31", type: "noEnd" },
      },
    });
    await updateMicrosoftCalendarEventForUser({
      ...reference,
      changes: {
        time: {
          end: "2026-01-31T12:00:00Z",
          kind: "timed",
          start: "2026-01-31T11:00:00Z",
          timeZone: "Europe/Berlin",
        },
      },
      version: event["@odata.etag"],
    });
    const mutation = request.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    );
    expect(JSON.parse(z.string().parse(mutation?.[1]?.body))).toMatchObject({
      recurrence: { pattern: { dayOfMonth: 31, type: "absoluteMonthly" } },
    });
  });

  test.each([
    { ...event, recurrence: null },
    { ...event, recurrence: null, seriesMasterId: "master-1" },
  ])(
    "does not add a repeat rule to standalone events or single occurrences",
    async (current) => {
      const request = mockCalendarEvent(current);
      await updateMicrosoftCalendarEventForUser({
        ...reference,
        changes: {
          time: {
            end: "2026-11-04T12:00:00Z",
            kind: "timed",
            start: "2026-11-04T11:00:00Z",
            timeZone: "Europe/Berlin",
          },
        },
        version: event["@odata.etag"],
      });
      const mutation = request.mock.calls.find(
        ([, init]) => init?.method === "PATCH"
      );
      expect(
        JSON.parse(z.string().parse(mutation?.[1]?.body))
      ).not.toHaveProperty("recurrence");
    }
  );
});
