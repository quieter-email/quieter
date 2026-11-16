import { describe, expect, test } from "vite-plus/test";

import type { CalendarAvailabilityInput } from "./availability";
import {
  calculateCalendarAvailability,
  calendarAvailabilityInputSchema,
  calendarAvailabilityResultSchema,
} from "./availability";
import type { CalendarEvent, CalendarSummary } from "./contracts";

const calendar: CalendarSummary = {
  access: "owner",
  calendarId: "calendar-a",
  connectionId: "connection-a",
  name: "Personal",
  primary: true,
  selected: true,
  supportsMeetings: false,
  timeZone: "UTC",
};
const preferences: CalendarAvailabilityInput["preferences"] = {
  bufferAfterMinutes: 0,
  bufferBeforeMinutes: 0,
  durationMinutes: 30,
  stepMinutes: 30,
  workingHours: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};

const createInput = (
  changes: Partial<CalendarAvailabilityInput> = {}
): CalendarAvailabilityInput =>
  calendarAvailabilityInputSchema.parse({
    calendars: [
      {
        calendarId: calendar.calendarId,
        connectionId: calendar.connectionId,
      },
    ],
    end: "2026-11-16T23:59:00Z",
    limit: 50,
    preferences,
    start: "2026-11-16T00:00:00Z",
    timeZone: "UTC",
    ...changes,
  });

const createEvent = (changes: Partial<CalendarEvent> = {}): CalendarEvent => ({
  attendees: [],
  availability: "busy",
  calendarId: calendar.calendarId,
  connectionId: calendar.connectionId,
  description: "",
  eventId: "event-a",
  location: "",
  meetingPending: false,
  permissions: { delete: true, edit: true, respond: true },
  recurrence: [],
  reminders: { kind: "default" },
  status: "confirmed",
  time: {
    end: "2026-11-16T10:00:00Z",
    kind: "timed",
    start: "2026-11-16T09:00:00Z",
    timeZone: "UTC",
  },
  title: "Busy",
  version: "v1",
  visibility: "default",
  ...changes,
});

describe("calendar availability", () => {
  test("combines overlapping busy calendars and returns the earliest bounded proposals", () => {
    const otherCalendar = { ...calendar, calendarId: "calendar-b" };
    const input = createInput({
      calendars: [calendar, otherCalendar].map(
        ({ calendarId, connectionId }) => ({ calendarId, connectionId })
      ),
      limit: 2,
    });
    const candidates = calculateCalendarAvailability({
      calendars: [
        {
          calendar,
          events: [
            createEvent({
              time: {
                end: "2026-11-16T10:30:00Z",
                kind: "timed",
                start: "2026-11-16T09:30:00Z",
                timeZone: "UTC",
              },
            }),
          ],
        },
        {
          calendar: otherCalendar,
          events: [
            createEvent({
              calendarId: otherCalendar.calendarId,
              time: {
                end: "2026-11-16T11:00:00Z",
                kind: "timed",
                start: "2026-11-16T10:00:00Z",
                timeZone: "UTC",
              },
            }),
          ],
        },
      ],
      input,
    });
    expect(candidates.map(({ start }) => start)).toStrictEqual([
      "2026-11-16T09:00:00Z",
      "2026-11-16T11:00:00Z",
    ]);
  });

  test("combines trusted holds with source events before limiting proposals", () => {
    const candidates = calculateCalendarAvailability({
      busyIntervals: [
        { end: "2026-11-16T11:00:00Z", start: "2026-11-16T10:00:00Z" },
        { end: "2026-11-16T10:15:00Z", start: "2026-11-16T09:30:00Z" },
      ],
      calendars: [{ calendar, events: [createEvent()] }],
      input: createInput({ limit: 2 }),
    });
    expect(candidates).toHaveLength(2);
    expect(candidates).toMatchObject([
      { start: "2026-11-16T11:00:00Z" },
      { start: "2026-11-16T11:30:00Z" },
    ]);
  });

  test("ignores free, cancelled and self-declined events while tentative and unanswered busy events block", () => {
    const candidates = calculateCalendarAvailability({
      calendars: [
        {
          calendar,
          events: [
            createEvent({ availability: "free" }),
            createEvent({ status: "cancelled" }),
            createEvent({
              attendees: [
                {
                  email: "owner@example.com",
                  optional: false,
                  organizer: false,
                  response: "declined",
                  self: true,
                },
              ],
            }),
            createEvent({
              status: "tentative",
              time: {
                end: "2026-11-16T11:00:00Z",
                kind: "timed",
                start: "2026-11-16T10:00:00Z",
                timeZone: "UTC",
              },
            }),
            createEvent({
              attendees: [
                {
                  email: "owner@example.com",
                  optional: false,
                  organizer: false,
                  response: "needs-action",
                  self: true,
                },
              ],
              time: {
                end: "2026-11-16T12:00:00Z",
                kind: "timed",
                start: "2026-11-16T11:00:00Z",
                timeZone: "UTC",
              },
            }),
          ],
        },
      ],
      input: createInput({
        preferences: { ...preferences, durationMinutes: 60 },
      }),
    });
    expect(candidates).toMatchObject([
      { end: "2026-11-16T10:00:00Z", start: "2026-11-16T09:00:00Z" },
    ]);
    expect(candidates).toHaveLength(1);
  });

  test.each(["source event", "trusted hold"])(
    "allows touching half-open intervals and places different buffers on the correct side of the proposal for a %s",
    (source) => {
      const time = {
        end: "2026-11-16T11:00:00Z",
        kind: "timed",
        start: "2026-11-16T10:00:00Z",
        timeZone: "UTC",
      } satisfies CalendarEvent["time"];
      const candidates = calculateCalendarAvailability({
        busyIntervals:
          source === "trusted hold"
            ? [{ end: time.end, start: time.start }]
            : [],
        calendars: [
          {
            calendar,
            events: source === "source event" ? [createEvent({ time })] : [],
          },
        ],
        input: createInput({
          preferences: {
            ...preferences,
            bufferAfterMinutes: 30,
            bufferBeforeMinutes: 15,
            stepMinutes: 15,
          },
        }),
      });
      expect(candidates.map(({ start }) => start)).toStrictEqual([
        "2026-11-16T09:00:00Z",
        "2026-11-16T11:15:00Z",
        "2026-11-16T11:30:00Z",
      ]);
    }
  );

  test.each([
    { end: "2026-11-16T10:00:00Z", start: "not-an-instant" },
    { end: "not-an-instant", start: "2026-11-16T09:00:00Z" },
    { end: "2026-11-16T09:00:00Z", start: "2026-11-16T09:00:00Z" },
    { end: "2026-11-16T08:00:00Z", start: "2026-11-16T09:00:00Z" },
  ])("rejects invalid trusted holds from $start to $end", (interval) => {
    expect(() =>
      calculateCalendarAvailability({
        busyIntervals: [interval],
        calendars: [{ calendar, events: [] }],
        input: createInput(),
      })
    ).toThrow(RangeError);
  });

  test.each([true, false])(
    "blocks all-day source dates with an exclusive end, using an event zone when present %s",
    (hasEventZone) => {
      const candidates = calculateCalendarAvailability({
        calendars: [
          {
            calendar: {
              ...calendar,
              timeZone: hasEventZone
                ? "America/Los_Angeles"
                : "Pacific/Auckland",
            },
            events: [
              createEvent({
                time: {
                  endDate: "2026-11-17",
                  kind: "all-day",
                  startDate: "2026-11-16",
                  ...(hasEventZone ? { timeZone: "Pacific/Auckland" } : {}),
                },
              }),
            ],
          },
        ],
        input: createInput({
          end: "2026-11-16T12:00:00Z",
          preferences: {
            ...preferences,
            durationMinutes: 60,
            stepMinutes: 60,
            workingHours: [{ endMinute: 720, startMinute: 0, weekday: 1 }],
          },
        }),
      });
      expect(candidates).toMatchObject([
        { end: "2026-11-16T12:00:00Z", start: "2026-11-16T11:00:00Z" },
      ]);
      expect(candidates).toHaveLength(1);
    }
  );

  test("uses expanded recurring instances separately without expanding their rule again", () => {
    const candidates = calculateCalendarAvailability({
      calendars: [
        {
          calendar,
          events: [
            createEvent({
              recurrence: ["RRULE:FREQ=HOURLY;COUNT=4"],
              recurringEventId: "series-a",
            }),
            createEvent({
              eventId: "event-b",
              recurringEventId: "series-a",
              time: {
                end: "2026-11-16T12:00:00Z",
                kind: "timed",
                start: "2026-11-16T11:00:00Z",
                timeZone: "UTC",
              },
            }),
          ],
        },
      ],
      input: createInput({
        preferences: {
          ...preferences,
          durationMinutes: 60,
          stepMinutes: 60,
          workingHours: [{ endMinute: 780, startMinute: 540, weekday: 1 }],
        },
      }),
    });
    expect(candidates.map(({ start }) => start)).toStrictEqual([
      "2026-11-16T10:00:00Z",
      "2026-11-16T12:00:00Z",
    ]);
  });

  test.each([
    ["Europe/Berlin", "2026-11-16T08:00:00Z", "2026-11-16T08:30:00Z"],
    ["America/New_York", "2026-11-16T14:00:00Z", "2026-11-16T14:30:00Z"],
  ])(
    "places working hours in %s while comparing events as instants",
    (timeZone, firstStart, busyStart) => {
      const candidates = calculateCalendarAvailability({
        calendars: [
          {
            calendar: { ...calendar, timeZone: "Asia/Tokyo" },
            events: [
              createEvent({
                time: {
                  end: busyStart.replace(":30:00Z", ":45:00Z"),
                  kind: "timed",
                  start: busyStart,
                  timeZone: "Asia/Tokyo",
                },
              }),
            ],
          },
        ],
        input: createInput({
          preferences: {
            ...preferences,
            workingHours: [{ endMinute: 660, startMinute: 540, weekday: 1 }],
          },
          timeZone,
        }),
      });
      expect(candidates[0]).toMatchObject({ start: firstStart, timeZone });
      expect(candidates.map(({ start }) => start)).not.toContain(busyStart);
      expect(candidates).toHaveLength(3);
    }
  );

  test("skips missing spring starts and keeps elapsed duration within the working window", () => {
    const candidates = calculateCalendarAvailability({
      calendars: [{ calendar, events: [] }],
      input: createInput({
        end: "2026-03-29T04:00:00Z",
        preferences: {
          ...preferences,
          durationMinutes: 60,
          workingHours: [{ endMinute: 240, startMinute: 60, weekday: 7 }],
        },
        start: "2026-03-29T00:00:00Z",
        timeZone: "Europe/Berlin",
      }),
    });
    expect(candidates.map(({ start }) => start)).toStrictEqual([
      "2026-03-29T00:00:00Z",
      "2026-03-29T00:30:00Z",
      "2026-03-29T01:00:00Z",
    ]);
    expect(candidates[0]).toMatchObject({ end: "2026-03-29T01:00:00Z" });
  });

  test("skips both occurrences of ambiguous autumn starts", () => {
    const candidates = calculateCalendarAvailability({
      calendars: [{ calendar, events: [] }],
      input: createInput({
        end: "2026-10-25T04:00:00Z",
        preferences: {
          ...preferences,
          durationMinutes: 60,
          workingHours: [{ endMinute: 240, startMinute: 60, weekday: 7 }],
        },
        start: "2026-10-24T22:00:00Z",
        timeZone: "Europe/Berlin",
      }),
    });
    expect(candidates.map(({ start }) => start)).toStrictEqual([
      "2026-10-24T23:00:00Z",
      "2026-10-24T23:30:00Z",
      "2026-10-25T02:00:00Z",
    ]);
  });

  test.each([
    ["2026-03-29", 120, 240],
    ["2026-10-25", 120, 240],
    ["2026-10-25", 60, 120],
  ])(
    "skips an uncertain working-window boundary on %s from %i to %i",
    (date, startMinute, endMinute) => {
      expect(
        calculateCalendarAvailability({
          calendars: [{ calendar, events: [] }],
          input: createInput({
            end: `${date}T23:00:00Z`,
            preferences: {
              ...preferences,
              workingHours: [{ endMinute, startMinute, weekday: 7 }],
            },
            start: `${date}T00:00:00Z`,
            timeZone: "Europe/Berlin",
          }),
        })
      ).toHaveLength(0);
    }
  );

  test("fits the entire meeting within the horizon and keeps the step anchored to working hours", () => {
    const candidates = calculateCalendarAvailability({
      calendars: [{ calendar, events: [] }],
      input: createInput({
        end: "2026-11-16T11:15:00Z",
        preferences: { ...preferences, durationMinutes: 60 },
        start: "2026-11-16T09:15:00Z",
      }),
    });
    expect(candidates.map(({ start }) => start)).toStrictEqual([
      "2026-11-16T09:30:00Z",
      "2026-11-16T10:00:00Z",
    ]);
  });

  test("uses the next local midnight for an end-of-day working window", () => {
    const candidates = calculateCalendarAvailability({
      calendars: [{ calendar, events: [] }],
      input: createInput({
        end: "2026-11-17T00:00:00Z",
        preferences: {
          ...preferences,
          durationMinutes: 60,
          workingHours: [{ endMinute: 1440, startMinute: 1380, weekday: 1 }],
        },
      }),
    });
    expect(candidates).toMatchObject([
      { end: "2026-11-17T00:00:00Z", start: "2026-11-16T23:00:00Z" },
    ]);
    expect(candidates).toHaveLength(1);
  });
});

describe("availability boundaries", () => {
  test("rejects trusted busy intervals in public availability input", () => {
    expect(
      calendarAvailabilityInputSchema.safeParse({
        ...createInput(),
        busyIntervals: [
          { end: "2026-11-16T10:00:00Z", start: "2026-11-16T09:00:00Z" },
        ],
      }).success
    ).toBeFalsy();
  });

  test("rejects reversed, empty, excessive and invalid instant ranges", () => {
    const input = createInput();
    for (const end of [
      input.start,
      "2026-11-15T00:00:00Z",
      "2026-12-18T00:00:00Z",
      "not-an-instant",
    ]) {
      expect(
        calendarAvailabilityInputSchema.safeParse({ ...input, end }).success
      ).toBeFalsy();
    }
  });

  test("rejects duplicate calendar pairs while allowing the same identifier on another connection", () => {
    const input = createInput();
    const ref = { calendarId: "primary", connectionId: "connection-a" };
    expect(
      calendarAvailabilityInputSchema.safeParse({
        ...input,
        calendars: [ref, ref],
      }).success
    ).toBeFalsy();
    expect(
      calendarAvailabilityInputSchema.safeParse({
        ...input,
        calendars: [ref, { ...ref, connectionId: "connection-b" }],
      }).success
    ).toBeTruthy();
  });

  test("rejects overlapping or reversed working hours and accepts touching windows on the same day", () => {
    const input = createInput();
    for (const workingHours of [
      [{ endMinute: 540, startMinute: 600, weekday: 1 }],
      [
        { endMinute: 660, startMinute: 540, weekday: 1 },
        { endMinute: 720, startMinute: 600, weekday: 1 },
      ],
    ]) {
      expect(
        calendarAvailabilityInputSchema.safeParse({
          ...input,
          preferences: { ...preferences, workingHours },
        }).success
      ).toBeFalsy();
    }
    expect(
      calendarAvailabilityInputSchema.safeParse({
        ...input,
        preferences: {
          ...preferences,
          workingHours: [
            { endMinute: 660, startMinute: 540, weekday: 1 },
            { endMinute: 720, startMinute: 660, weekday: 1 },
          ],
        },
      }).success
    ).toBeTruthy();
  });

  test("rejects private event details in the public result", () => {
    const input = createInput();
    const result = {
      candidates: [],
      checkedAt: input.start,
      coverage: [{ calendar: input.calendars[0], status: "complete" }],
      explanation: "Only the calendar owner was checked.",
      status: "complete",
      timeZone: input.timeZone,
    };
    expect(
      calendarAvailabilityResultSchema.safeParse({
        ...result,
        events: [createEvent()],
      }).success
    ).toBeFalsy();
  });

  test.each([
    { complete: [], status: "unavailable" },
    {
      complete: [{ calendarId: "calendar-b", connectionId: "connection-a" }],
      status: "partial",
    },
  ])("withholds proposals for $status coverage", ({ complete, status }) => {
    const input = createInput();
    const result = {
      candidates: [],
      checkedAt: input.start,
      coverage: [
        ...complete.map((ref) => ({ calendar: ref, status: "complete" })),
        {
          calendar: input.calendars[0],
          reason: "temporary",
          status: "unavailable",
        },
      ],
      explanation: "Some selected calendars could not be checked.",
      status,
      timeZone: input.timeZone,
    };
    expect(
      calendarAvailabilityResultSchema.safeParse(result).success
    ).toBeTruthy();
    expect(
      calendarAvailabilityResultSchema.safeParse({
        ...result,
        candidates: [
          {
            end: "2026-11-16T10:00:00Z",
            start: "2026-11-16T09:00:00Z",
            timeZone: "UTC",
          },
        ],
      }).success
    ).toBeFalsy();
  });
});
