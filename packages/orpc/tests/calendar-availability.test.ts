import { calendarAvailabilityInputSchema } from "@quieter/calendar/availability";
import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { proposeCalendarAvailabilityForUser } from "../src/calendar/availability";
/* oxlint-disable eslint/require-await -- Transport fixtures preserve asynchronous provider and database contracts. */
import { CALENDAR_SCOPES } from "../src/gmail-mailbox-access";
import type { PreparedGmailMailboxIdentity } from "../src/gmail-mailbox-access";

const mocks = vi.hoisted(() => ({
  gmailScopes: "",
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The SQL proxy checks actor predicates through the real calendar service.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
vi.mock(import("../src/gmail-mailbox-access"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAuthorizedGmailMailbox: async <T>(
      input: Parameters<typeof actual.runAuthorizedGmailMailbox>[0],
      run: (token: string, identity: PreparedGmailMailboxIdentity) => Promise<T>
    ): Promise<T> =>
      await run("fixture-token", {
        googleSubject: "owned-subject",
        mailboxId: input.mailboxId,
      }),
  };
});
vi.mock(import("../src/connectors/runtime"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAuthorizedConnector: async <T>(
      input: Parameters<typeof actual.runAuthorizedConnector>[0],
      run: (token: string, signal?: AbortSignal) => Promise<T>
    ): Promise<T> => await run("fixture-token", input.signal),
  };
});

const googleCalendar = {
  accessRole: "owner",
  id: "personal",
  primary: true,
  timeZone: "Europe/Berlin",
};
const microsoftCalendar = {
  canEdit: true,
  id: "work",
  name: "Work",
};
const input = calendarAvailabilityInputSchema.parse({
  calendars: [
    { calendarId: "personal", connectionId: "owned-mailbox" },
    { calendarId: "work", connectionId: "owned-connector" },
  ],
  end: "2027-01-11T12:00:00Z",
  preferences: {
    bufferAfterMinutes: 15,
    bufferBeforeMinutes: 15,
    durationMinutes: 30,
    workingHours: [{ endMinute: 12 * 60, startMinute: 9 * 60, weekday: 1 }],
  },
  start: "2027-01-11T09:00:00Z",
  timeZone: "UTC",
});

const respond = (request: Request) => {
  if (request.url.includes("googleapis.com")) {
    if (request.url.includes("/events")) {
      return Response.json({
        items: [
          {
            end: { dateTime: "2027-01-11T10:00:00Z" },
            etag: "g1",
            id: "recurring-occurrence",
            recurringEventId: "recurring-series",
            start: { dateTime: "2027-01-11T09:00:00Z" },
            status: "confirmed",
          },
        ],
      });
    }
    return Response.json(
      new URL(request.url).pathname.endsWith("/calendarList")
        ? { items: [googleCalendar] }
        : googleCalendar
    );
  }
  if (request.url.includes("calendarView")) {
    return Response.json({
      value: [
        {
          "@odata.etag": "m1",
          end: { dateTime: "2027-01-11T11:00:00", timeZone: "UTC" },
          id: "tentative-occurrence",
          isAllDay: false,
          isOrganizer: true,
          seriesMasterId: "work-series",
          showAs: "tentative",
          start: { dateTime: "2027-01-11T10:30:00", timeZone: "UTC" },
        },
      ],
    });
  }
  return Response.json(
    new URL(request.url).pathname.endsWith("/calendars")
      ? { value: [microsoftCalendar] }
      : microsoftCalendar
  );
};

describe("authorized availability fixtures", () => {
  beforeEach(() => {
    mocks.gmailScopes = CALENDAR_SCOPES.join(" ");
    mocks.query.mockReset().mockImplementation(async (query, params) => {
      if (params.includes("microsoft_calendar")) {
        return {
          rows: [
            [
              "owner@example.com",
              null,
              "owned-connector",
              "Calendars.ReadWrite offline_access",
              "connected",
            ],
          ],
        };
      }
      if (query.includes('from "connectorCredential"')) {
        return { rows: [] };
      }
      return {
        rows: [
          [
            null,
            "owner@example.com",
            "owned-subject",
            "owned-mailbox",
            mocks.gmailScopes,
            "connected",
          ],
        ],
      };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("checks expanded calendars across providers without notification-producing writes", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => respond(new Request(url, init)));
    vi.stubGlobal("fetch", request);
    const result = await proposeCalendarAvailabilityForUser({
      ...input,
      userId: "owner",
    });
    expect(result.status).toBe("complete");
    expect(result.candidates[0]).toMatchObject({
      end: "2027-01-11T11:45:00Z",
      start: "2027-01-11T11:15:00Z",
    });
    const requests = request.mock.calls.map(
      ([url, init]) => new Request(url, init)
    );
    expect(requests.every((call) => call.method === "GET")).toBeTruthy();
    expect(
      requests.some((call) => call.url.includes("singleEvents=true"))
    ).toBeTruthy();
    expect(
      requests.some((call) => call.url.includes("calendarView"))
    ).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("recurring-series");
  });

  test("foreign connections cannot read provider data or imply free time", async () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const result = await proposeCalendarAvailabilityForUser({
      ...input,
      calendars: [{ calendarId: "personal", connectionId: "foreign-account" }],
      userId: "actor",
    });
    expect(result).toMatchObject({
      candidates: [],
      coverage: [{ reason: "not-found" }],
      status: "unavailable",
    });
    expect(request).not.toHaveBeenCalled();
    const query = mocks.query.mock.calls.find(([sql]) =>
      sql.includes('from "mailbox"')
    );
    expect(query?.[0]).toContain('"mailbox"."ownerUserId" =');
    expect(query?.[1]).toContain("actor");
  });

  test("partial permissions withhold candidates and a retry recovers", async () => {
    let unavailable = true;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        const call = new Request(url, init);
        return unavailable && call.url.includes("graph.microsoft.com")
          ? new Response(null, { status: 403 })
          : respond(call);
      });
    vi.stubGlobal("fetch", request);
    const selection = {
      ...input,
      busyIntervals: [
        { end: "2027-01-11T11:15:00Z", start: "2027-01-11T11:00:00Z" },
      ],
      limit: 1,
      userId: "owner",
    };
    const partial = await proposeCalendarAvailabilityForUser(selection);
    expect(partial).toMatchObject({
      candidates: [],
      coverage: [{ status: "complete" }, { reason: "permission" }],
      status: "partial",
    });
    unavailable = false;
    const recovered = await proposeCalendarAvailabilityForUser(selection);
    expect(recovered.status).toBe("complete");
    expect(recovered.candidates).toHaveLength(1);
    expect(recovered.candidates[0]).toMatchObject({
      end: "2027-01-11T12:00:00Z",
      start: "2027-01-11T11:30:00Z",
    });
  });

  test.each([
    { end: "2027-01-11T11:15:00Z", start: "not-an-instant" },
    { end: "2027-01-11T10:00:00Z", start: "2027-01-11T11:00:00Z" },
  ])(
    "invalid trusted holds reject instead of implying availability",
    async (interval) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn<typeof fetch>()
          .mockImplementation(async (url, init) =>
            respond(new Request(url, init))
          )
      );
      await expect(
        proposeCalendarAvailabilityForUser({
          ...input,
          busyIntervals: [interval],
          userId: "owner",
        })
      ).rejects.toThrow(RangeError);
    }
  );

  test("current scope loss requires permission repair before any event read", async () => {
    mocks.gmailScopes = "";
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => respond(new Request(url, init)));
    vi.stubGlobal("fetch", request);
    const selection = {
      ...input,
      calendars: [{ calendarId: "personal", connectionId: "owned-mailbox" }],
      userId: "owner",
    };
    const denied = await proposeCalendarAvailabilityForUser(selection);
    expect(denied).toMatchObject({
      candidates: [],
      coverage: [{ reason: "permission" }],
      status: "unavailable",
    });
    expect(request).not.toHaveBeenCalled();
    mocks.gmailScopes = CALENDAR_SCOPES.join(" ");
    const repaired = await proposeCalendarAvailabilityForUser(selection);
    expect(repaired.status).toBe("complete");
    expect(repaired.candidates.length).toBeGreaterThan(0);
  });

  test("an unknown all-day source timezone cannot imply complete coverage", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        const call = new Request(url, init);
        if (call.url.includes("/events")) {
          return Response.json({
            items: [
              {
                end: { date: "2027-01-12" },
                etag: "all-day-version",
                id: "unknown-zone-event",
                start: { date: "2027-01-11" },
              },
            ],
          });
        }
        const unknownZoneCalendar = {
          accessRole: "owner",
          id: "personal",
          primary: true,
        };
        return Response.json(
          new URL(call.url).pathname.endsWith("/calendarList")
            ? { items: [unknownZoneCalendar] }
            : unknownZoneCalendar
        );
      });
    vi.stubGlobal("fetch", request);
    const result = await proposeCalendarAvailabilityForUser({
      ...input,
      calendars: [{ calendarId: "personal", connectionId: "owned-mailbox" }],
      userId: "owner",
    });
    expect(result).toMatchObject({
      candidates: [],
      coverage: [{ reason: "unsupported" }],
      status: "unavailable",
    });
  });

  test("all-day calendar reads retain their source timezone before calculating slots", async () => {
    const allDay = {
      "@odata.etag": "all-day-version",
      end: { dateTime: "2027-01-12T08:00:00", timeZone: "UTC" },
      id: "all-day",
      isAllDay: true,
      isOrganizer: true,
      originalStartTimeZone: "Pacific Standard Time",
      start: { dateTime: "2027-01-11T08:00:00", timeZone: "UTC" },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        const call = new Request(url, init);
        if (call.url.includes("calendarView")) {
          return Response.json({ value: [allDay] });
        }
        if (call.url.includes("/events/")) {
          return Response.json(
            call.headers
              .get("prefer")
              ?.includes('outlook.timezone="Pacific Standard Time"') === true
              ? {
                  ...allDay,
                  end: {
                    dateTime: "2027-01-12T00:00:00",
                    timeZone: "Pacific Standard Time",
                  },
                  start: {
                    dateTime: "2027-01-11T00:00:00",
                    timeZone: "Pacific Standard Time",
                  },
                }
              : allDay
          );
        }
        return respond(call);
      });
    vi.stubGlobal("fetch", request);
    const result = await proposeCalendarAvailabilityForUser({
      ...input,
      calendars: [{ calendarId: "work", connectionId: "owned-connector" }],
      end: "2027-01-12T10:00:00Z",
      preferences: {
        ...input.preferences,
        workingHours: [{ endMinute: 10 * 60, startMinute: 7 * 60, weekday: 2 }],
      },
      start: "2027-01-12T07:00:00Z",
      userId: "owner",
    });
    expect(result.status).toBe("complete");
    expect(result.candidates[0]).toMatchObject({
      start: "2027-01-12T08:15:00Z",
    });
  });

  test("abort cancels the request instead of returning a misleading empty search", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(
      proposeCalendarAvailabilityForUser({
        ...input,
        signal: controller.signal,
        userId: "owner",
      })
    ).rejects.toThrow(/abort/iu);
    expect(request).not.toHaveBeenCalled();
  });
});
