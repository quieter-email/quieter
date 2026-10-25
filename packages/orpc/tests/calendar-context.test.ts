import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import { listGoogleCalendarEventsForUser } from "../src/connectors/runtime";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// The proxy exercises the actual owner and provider predicates without a live connection.
// oxlint-disable-next-line vitest/prefer-import-in-mock
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

const range = {
  maxResults: 2,
  timeMax: "2026-10-24T00:00:00-07:00",
  timeMin: "2026-10-23T00:00:00-07:00",
};

const timedEvent = {
  end: { dateTime: "2026-10-23T10:00:00-07:00" },
  id: "meeting",
  start: { dateTime: "2026-10-23T09:00:00-07:00" },
  summary: "Planning",
};

describe("live calendar context", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({
      rows: [
        [
          new Date("2099-01-01T00:00:00Z"),
          "owner-credential",
          null,
          "credential-id",
          "google_calendar",
          "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar.events",
          "connected",
        ],
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("reads only the caller's connected calendar and preserves live time evidence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T01:30:00Z"));
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            ...timedEvent,
            attendees: [{ responseStatus: "declined", self: true }],
            transparency: "transparent",
          },
          {
            end: { date: "2026-10-25" },
            id: "all-day",
            start: { date: "2026-10-23" },
          },
        ],
        timeZone: "America/Los_Angeles",
      })
    );
    vi.stubGlobal("fetch", request);

    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      listGoogleCalendarEventsForUser({ ...range, userId: "other" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(request).not.toHaveBeenCalled();

    const result = await listGoogleCalendarEventsForUser({
      ...range,
      userId: "owner",
    });
    expect(mocks.query.mock.calls).toStrictEqual(
      expect.arrayContaining([
        [
          expect.stringContaining('"connectorCredential"."userId"'),
          expect.arrayContaining(["owner", "google_calendar"]),
          "all",
        ],
      ])
    );
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/calendars/primary/events?"),
      expect.objectContaining({
        headers: { authorization: "Bearer token-owner-credential" },
      })
    );
    expect(result).toMatchObject({
      calendarId: "primary",
      currentDate: "2026-10-22",
      events: [
        {
          responseStatus: "declined",
          start: timedEvent.start,
          transparency: "transparent",
        },
        {
          end: { date: "2026-10-25" },
          start: { date: "2026-10-23" },
          transparency: "opaque",
        },
      ],
      partial: false,
      status: "success",
      timeZone: "America/Los_Angeles",
    });
  });

  test.each([
    { timeMin: "2026-10-23T00:00:00" },
    { timeMax: "2026-10-20T00:00:00Z" },
    { timeMax: "2027-10-23T00:00:00Z" },
    { maxResults: 100_000 },
  ])(
    "rejects an unsafe or ambiguous range before authorization or provider I/O",
    async (invalid) => {
      const request = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", request);
      await expect(
        listGoogleCalendarEventsForUser({
          ...range,
          ...invalid,
          userId: "owner",
        })
      ).rejects.toThrow(/./u);
      expect(mocks.query).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }
  );

  test("bounds results even when the provider returns excess records and exposes continuation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          timedEvent,
          { ...timedEvent, id: "second" },
          { ...timedEvent, id: "extra" },
        ],
        nextPageToken: "continuation",
        timeZone: "America/Los_Angeles",
      })
    );
    vi.stubGlobal("fetch", request);
    const result = await listGoogleCalendarEventsForUser({
      ...range,
      pageToken: "previous",
      query: "planning",
      userId: "owner",
    });
    expect(result).toMatchObject({
      nextPageToken: "continuation",
      partial: true,
      status: "success",
    });
    expect(result).toHaveProperty("events.length", range.maxResults);
    const url = new URL(z.string().parse(request.mock.calls[0]?.[0]));
    expect(url.searchParams.get("q")).toBe("planning");
    expect(url.searchParams.get("pageToken")).toBe("previous");
    expect(url.searchParams.get("singleEvents")).toBe("true");
  });

  test("stops before I/O when the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      listGoogleCalendarEventsForUser({
        ...range,
        signal: controller.signal,
        userId: "owner",
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  test("keeps provider error bodies out of exceptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { message: "private-calendar-content" } },
            { status: 500 }
          )
        )
    );
    await expect(
      listGoogleCalendarEventsForUser({ ...range, userId: "owner" })
    ).rejects.toThrow("Google Calendar request failed with status 500.");
  });
});
