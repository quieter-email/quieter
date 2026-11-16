/* oxlint-disable eslint/require-await -- Calendar fixtures preserve asynchronous service contracts. */
import { ORPCError } from "@orpc/server";
import { calendarEventSchema } from "@quieter/calendar";
import type { CalendarSummary } from "@quieter/calendar";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  calendarProposalCreateInputSchema,
  createCalendarProposalEventForUser,
} from "../src/calendar/proposals";
import type * as CalendarService from "../src/calendar/service";
import type * as MailboxService from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof MailboxService.assertAccessibleMailbox>(),
  calendars: vi.fn<typeof CalendarService.listCalendarsForUser>(),
  create: vi.fn<typeof CalendarService.createCalendarEventForUser>(),
  events: vi.fn<typeof CalendarService.listCalendarEventsForUser>(),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: mocks.access,
}));
vi.mock(import("../src/calendar/service"), () => ({
  createCalendarEventForUser: mocks.create,
  listCalendarEventsForUser: mocks.events,
  listCalendarsForUser: mocks.calendars,
}));

const calendars: CalendarSummary[] = [
  {
    access: "owner",
    calendarId: "personal",
    connectionId: "actor-personal",
    name: "Personal",
    primary: true,
    selected: false,
    supportsMeetings: true,
    timeZone: "Europe/Berlin",
  },
  {
    access: "read",
    calendarId: "work",
    connectionId: "actor-work",
    name: "Work",
    primary: false,
    selected: true,
    supportsMeetings: true,
    timeZone: "UTC",
  },
];
const input = calendarProposalCreateInputSchema.parse({
  availability: {
    calendars: calendars.map(({ calendarId, connectionId }) => ({
      calendarId,
      connectionId,
    })),
    end: "2027-01-11T12:00:00Z",
    preferences: {
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 15,
      durationMinutes: 30,
      workingHours: [{ endMinute: 12 * 60, startMinute: 9 * 60, weekday: 1 }],
    },
    start: "2027-01-11T09:00:00Z",
    timeZone: "UTC",
  },
  calendarId: "personal",
  connectionId: "actor-personal",
  event: {
    time: {
      end: "2027-01-11T11:00:00+01:00",
      kind: "timed",
      start: "2027-01-11T10:30:00+01:00",
      timeZone: "Europe/Berlin",
    },
    title: "Planning",
  },
  mailboxId: "shared-mailbox",
  operationId: "d2d2a899-ed59-475e-a806-c8e42b847e9a",
});
const busyEvent = calendarEventSchema.parse({
  attendees: [],
  availability: "busy",
  calendarId: "work",
  connectionId: "actor-work",
  description: "",
  eventId: "new-conflict",
  location: "",
  meetingPending: false,
  permissions: { delete: false, edit: false, respond: false },
  recurrence: [],
  reminders: { kind: "default" },
  status: "confirmed",
  time: input.event.time,
  title: "Another meeting",
  version: "current-version",
  visibility: "default",
});

describe("rechecked calendar proposal creation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-11T08:00:00Z"));
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({
        provider: "managed",
        role: "responder",
      }),
      contentRevision: 0,
      id: input.mailboxId,
      organizationId: "team",
      provider: "managed",
    });
    mocks.calendars.mockImplementation(async (request) => ({
      calendars: calendars.filter(
        (calendar) => calendar.connectionId === request.connectionId
      ),
    }));
    mocks.events.mockResolvedValue({ events: [] });
    mocks.create.mockResolvedValue({
      action: "created",
      calendarId: input.calendarId,
      connectionId: input.connectionId,
      eventId: "created-meeting",
      status: "success",
    });
  });
  afterEach(() => vi.useRealTimers());

  test("rejects a destination connection outside the explicit checked scope", () => {
    expect(
      calendarProposalCreateInputSchema.safeParse({
        ...input,
        connectionId: "mailbox-owner-calendar",
      }).success
    ).toBeFalsy();
  });

  test.each([
    {
      event: { ...input.event, recurrence: ["RRULE:FREQ=WEEKLY"] },
      label: "recurring meetings",
    },
    {
      event: {
        ...input.event,
        time: {
          endDate: "2027-01-12",
          kind: "all-day",
          startDate: "2027-01-11",
        },
      },
      label: "all-day meetings",
    },
    {
      event: {
        ...input.event,
        time: { ...input.event.time, end: "2027-01-11T11:30:00+01:00" },
      },
      label: "a duration different from the availability search",
    },
    {
      event: {
        ...input.event,
        time: { ...input.event.time, end: "2027-01-11T11:00:00.0001+01:00" },
      },
      label: "unrepresented submillisecond precision",
    },
  ])("rejects $label", ({ event }) => {
    expect(
      calendarProposalCreateInputSchema.safeParse({ ...input, event }).success
    ).toBeFalsy();
  });

  test("denied mailbox access cannot inspect calendars or create a meeting", async () => {
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      createCalendarProposalEventForUser({ ...input, userId: "actor" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.calendars).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("a new conflict in any selected calendar prevents the event write", async () => {
    mocks.events.mockImplementation(async (request) => ({
      events: request.connectionId === "actor-work" ? [busyEvent] : [],
    }));
    await expect(
      createCalendarProposalEventForUser({ ...input, userId: "actor" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test.each([
    { code: "UNAUTHORIZED", failure: new ORPCError("UNAUTHORIZED") },
    { code: "FORBIDDEN", failure: new ORPCError("FORBIDDEN") },
    { code: "CONFLICT", failure: new ORPCError("NOT_FOUND") },
  ])(
    "incomplete source coverage reports $code without writing",
    async ({ code, failure }) => {
      mocks.calendars.mockImplementation(async (request) => {
        if (request.connectionId === "actor-work") {
          throw failure;
        }
        return {
          calendars: calendars.filter(
            (calendar) => calendar.connectionId === request.connectionId
          ),
        };
      });
      await expect(
        createCalendarProposalEventForUser({ ...input, userId: "actor" })
      ).rejects.toMatchObject({ code });
      expect(mocks.create).not.toHaveBeenCalled();
    }
  );

  test("a free interval creates under the actor with the exact checked sources and operation", async () => {
    const result = await createCalendarProposalEventForUser({
      ...input,
      userId: "actor",
    });
    expect(result).toMatchObject({
      action: "created",
      eventId: "created-meeting",
      status: "success",
    });
    expect(mocks.access).toHaveBeenCalledWith({
      mailboxId: "shared-mailbox",
      userId: "actor",
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      calendarId: input.calendarId,
      connectionId: input.connectionId,
      event: input.event,
      operationId: input.operationId,
      signal: undefined,
      userId: "actor",
    });
    expect(mocks.events).toHaveBeenCalledTimes(2);
    for (const calendar of input.availability.calendars) {
      expect(mocks.events).toHaveBeenCalledWith(
        expect.objectContaining({
          ...calendar,
          end: "2027-01-11T10:15:00.000Z",
          start: "2027-01-11T09:15:00.000Z",
          timeZone: "UTC",
          userId: "actor",
        })
      );
    }
  });

  test("a free interval outside the preferred candidate grid is not accepted", async () => {
    const offGrid = calendarProposalCreateInputSchema.parse({
      ...input,
      event: {
        ...input.event,
        time: {
          ...input.event.time,
          end: "2027-01-11T10:07:00Z",
          start: "2027-01-11T09:37:00Z",
        },
      },
    });
    await expect(
      createCalendarProposalEventForUser({ ...offGrid, userId: "actor" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("past meetings are rejected before checking calendars", async () => {
    vi.setSystemTime(new Date("2027-01-11T10:00:00Z"));
    await expect(
      createCalendarProposalEventForUser({ ...input, userId: "actor" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("an interval that starts during the recheck cannot be created", async () => {
    mocks.events.mockImplementation(async () => {
      vi.setSystemTime(new Date("2027-01-11T09:30:01Z"));
      return { events: [] };
    });
    await expect(
      createCalendarProposalEventForUser({ ...input, userId: "actor" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
