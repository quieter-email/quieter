import { foregroundSnapshotSchema } from "@quieter/ai/chat-tools";
import { calendarEventsInputSchema } from "@quieter/calendar";
import type * as DatabaseClientModule from "@quieter/database/client";
import type { reportError } from "@quieter/observability";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { listCalendarEventsForUser } from "../src/calendar/service";
import { createCalendarToolsContext } from "../src/chat/calendar-tools";
import { GOOGLE_CALENDAR_SCOPES } from "../src/connectors/runtime";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy exercises the actual ownership predicates without a live database.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: (encrypted: string) => `token-${encrypted}`,
  encryptGmailCredentialSecret: vi.fn<() => string>(),
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  requireServerEnv: () => "calendar-test-fixture",
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<typeof reportError>(),
}));

const range = {
  calendarId: "team-calendar",
  connectionId: "connection-1",
  end: "2026-10-24T00:00:00-07:00",
  start: "2026-10-23T00:00:00-07:00",
  timeZone: "America/Los_Angeles",
};
const calendar = {
  accessRole: "reader",
  id: range.calendarId,
  timeZone: range.timeZone,
};
const timedEvent = {
  end: { dateTime: "2026-10-23T10:00:00-07:00" },
  etag: "version-1",
  id: "meeting",
  start: { dateTime: "2026-10-23T09:00:00-07:00" },
  summary: "Planning",
};
const foreground = foregroundSnapshotSchema.parse({
  capabilities: [],
  exchangeId: "d6c6b64a-1d5f-4406-9b1b-53a73ff6f41b",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  tabId: "calendar-context",
});

describe("live calendar context", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockImplementation(
      async (query) =>
        await Promise.resolve({
          rows: query.includes('"accessTokenExpiresAt"')
            ? [
                [
                  new Date("2099-01-01T00:00:00Z"),
                  "owner-credential",
                  null,
                  range.connectionId,
                  "google_calendar",
                  GOOGLE_CALENDAR_SCOPES.join(" "),
                  "connected",
                ],
              ]
            : [["owner@example.test", range.connectionId]],
        })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("reads only the caller's selected connection and preserves time and availability evidence across pages", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(calendar))
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              ...timedEvent,
              attendees: [
                {
                  email: "owner@example.test",
                  responseStatus: "declined",
                  self: true,
                },
              ],
              transparency: "transparent",
            },
          ],
          nextPageToken: "continuation",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              end: { date: "2026-10-25" },
              etag: "all-day-version",
              id: "all-day",
              start: { date: "2026-10-23" },
            },
          ],
        })
      );
    vi.stubGlobal("fetch", request);
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      listCalendarEventsForUser({ ...range, userId: "other" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(request).not.toHaveBeenCalled();

    const result = await listCalendarEventsForUser({
      ...range,
      query: "planning",
      userId: "owner",
    });
    for (const [query, values] of mocks.query.mock.calls.slice(1)) {
      expect(query).toContain('"connectorCredential"."userId" =');
      expect(query).toContain('"connectorCredential"."provider" =');
      expect(query).toContain('"connectorCredential"."id" =');
      expect(values).toStrictEqual(
        expect.arrayContaining(["owner", "google_calendar", range.connectionId])
      );
    }
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/calendars/team-calendar/events?"),
      expect.objectContaining({
        headers: { authorization: "Bearer token-owner-credential" },
      })
    );
    expect(result.events).toHaveLength(2);
    expect(result.events).toMatchObject([
      {
        attendees: [{ response: "declined", self: true }],
        availability: "free",
        calendarId: range.calendarId,
        connectionId: range.connectionId,
        time: {
          end: timedEvent.end.dateTime,
          kind: "timed",
          start: timedEvent.start.dateTime,
          timeZone: range.timeZone,
        },
      },
      {
        availability: "busy",
        time: {
          endDate: "2026-10-25",
          kind: "all-day",
          startDate: "2026-10-23",
        },
      },
    ]);
    const urls = request.mock.calls
      .slice(1)
      .map(([url]) => new URL(new Request(url).url));
    expect(
      urls.every(
        (url) =>
          url.searchParams.get("q") === "planning" &&
          url.searchParams.get("timeZone") === range.timeZone &&
          url.searchParams.get("singleEvents") === "true"
      )
    ).toBeTruthy();
    expect(urls[1]?.searchParams.get("pageToken")).toBe("continuation");
  });

  test("keeps free-busy calendar blocks anonymous and read only", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ ...calendar, accessRole: "freeBusyReader" })
        )
        .mockResolvedValueOnce(
          Response.json({ items: [{ ...timedEvent, summary: undefined }] })
        )
    );
    const result = await listCalendarEventsForUser({
      ...range,
      userId: "owner",
    });
    expect(result.events).toMatchObject([
      {
        attendees: [],
        availability: "busy",
        description: "",
        permissions: { delete: false, edit: false, respond: false },
        title: "Busy",
      },
    ]);
  });

  test.each([
    { start: "2026-10-23T00:00:00" },
    { end: "2026-10-20T00:00:00Z" },
    { end: "2027-10-23T00:00:00Z" },
  ])(
    "rejects an ambiguous or unsafe read range at the input boundary",
    (invalid) => {
      expect(
        calendarEventsInputSchema.safeParse({ ...range, ...invalid }).success
      ).toBeFalsy();
    }
  );

  test("stops a cancelled read before credential or provider I/O", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const context = createCalendarToolsContext({
      foreground,
      transcript: [],
      userId: "owner",
    });
    await expect(
      context.listEvents(range, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test("keeps provider error bodies out of assistant responses", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(calendar))
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "private-calendar-content" } },
          { status: 500 }
        )
      );
    vi.stubGlobal("fetch", request);
    const context = createCalendarToolsContext({
      foreground,
      transcript: [],
      userId: "owner",
    });
    const result = await context.listEvents(range);
    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error("Expected a safe calendar failure");
    }
    expect(result.error).not.toHaveLength(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("private-calendar-content");
  });
});
