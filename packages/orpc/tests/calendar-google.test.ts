/* oxlint-disable eslint/require-await -- Fetch mocks preserve the asynchronous transport contract. */
import {
  calendarEventDraftSchema,
  calendarUpdateColorInputSchema,
} from "@quieter/calendar";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import {
  createGoogleEvent,
  getGoogleColors,
  googleEventChanges,
  listGoogleEvents,
  toCalendarEvent,
  toCalendarSummary,
} from "../src/calendar/google";

const calendar = {
  accessRole: "owner" as const,
  id: "calendar-1",
  timeZone: "Europe/Berlin",
};
const auth = { accessToken: "test-token", calendarId: calendar.id };
const draft = calendarEventDraftSchema.parse({
  time: { endDate: "2026-10-25", kind: "all-day", startDate: "2026-10-23" },
  title: "Planning",
});
const current = {
  attendees: [
    { email: "guest@example.com", responseStatus: "accepted" as const },
  ],
  end: { date: "2026-10-25" },
  etag: '"version-1"',
  id: "event-1",
  organizer: { self: true },
  start: { date: "2026-10-23" },
  summary: "Planning",
};

describe("calendar provider boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("resolves live event colors while preserving custom calendar colors and default inheritance", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      Response.json(
        new Request(url).url.endsWith("/colors")
          ? {
              calendar: {
                "calendar-tone": {
                  background: "#123456",
                  foreground: "#ffffff",
                },
              },
              event: {
                "event-tone": { background: "#aabbcc", foreground: "#000000" },
              },
            }
          : { items: [{ ...current, colorId: "event-tone" }] }
      )
    );
    vi.stubGlobal("fetch", request);
    const sources = await listGoogleEvents(auth);
    const colors = await getGoogleColors(auth);
    const customCalendar = {
      ...calendar,
      backgroundColor: "#654321",
      colorId: "calendar-tone",
    };
    const mapped = sources.map((event) =>
      toCalendarEvent({
        calendar: customCalendar,
        colors,
        connectionId: "account-1",
        event,
      })
    );
    expect(mapped[0]).toMatchObject({
      color: "#aabbcc",
      colorOverride: "#aabbcc",
    });
    expect(mapped[0]).not.toHaveProperty("colorId");
    expect(
      toCalendarSummary({
        calendar: customCalendar,
        colors,
        connectionId: "account-1",
      }).color
    ).toBe("#654321");
    const inherited = toCalendarEvent({
      calendar: customCalendar,
      colors,
      connectionId: "account-1",
      event: current,
    });
    expect(inherited.color).toBe("#654321");
    expect(inherited).not.toHaveProperty("colorOverride");
    expect(
      toCalendarEvent({
        calendar: { ...calendar, colorId: "calendar-tone" },
        colors,
        connectionId: "account-1",
        event: current,
      }).color
    ).toBe("#123456");
    expect(
      googleEventChanges({
        changes: { color: "#AABBCC" },
        colors,
        meetingRequestId: "meeting-1",
      })
    ).toMatchObject({ colorId: "event-tone" });
    expect(
      googleEventChanges({
        changes: { color: null },
        colors,
        meetingRequestId: "meeting-1",
      })
    ).toMatchObject({ colorId: null });
    expect(() =>
      googleEventChanges({
        changes: { color: "#abcdef" },
        colors,
        meetingRequestId: "meeting-1",
      })
    ).toThrow(/available event colors/u);
    expect(
      calendarUpdateColorInputSchema.safeParse({
        calendarId: calendar.id,
        color: "red; display:none",
        connectionId: "account-1",
      }).success
    ).toBeFalsy();
    request.mockRejectedValue(
      new Error("The cached palette should remain available.")
    );
    await expect(
      getGoogleColors({ accessToken: "another-owner-token" })
    ).resolves.toMatchObject({
      event: { "event-tone": { background: "#aabbcc" } },
    });
  });

  test("loads every recurring-expanded page and keeps exclusive all-day dates", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [current], nextPageToken: "more" })
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            { ...current, id: "occurrence-2", recurringEventId: "series-id" },
          ],
        })
      );
    vi.stubGlobal("fetch", request);
    const events = await listGoogleEvents({
      ...auth,
      end: "2026-10-30T00:00:00Z",
      start: "2026-10-20T00:00:00Z",
      timeZone: "Europe/Berlin",
    });
    expect(events).toHaveLength(2);
    const mapped = events.map((event) =>
      toCalendarEvent({ calendar, connectionId: "account-1", event })
    );
    expect(mapped[0]?.time).toMatchObject({
      endDate: "2026-10-25",
      kind: "all-day",
      startDate: "2026-10-23",
    });
    expect(mapped[1]).toMatchObject({
      eventId: "occurrence-2",
      recurringEventId: "series-id",
    });
    const urls = request.mock.calls.map(([url]) => new Request(url).url);
    expect(urls.every((url) => url.includes("singleEvents=true"))).toBeTruthy();
    expect(urls[1]).toContain("pageToken=more");
  });

  test("fails a nonadvancing page instead of silently truncating results", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          Response.json({ items: [], nextPageToken: "same" })
        )
    );
    await expect(listGoogleEvents(auth)).rejects.toThrow("pagination");
  });

  test("preserves existing guest responses when editing guests", () => {
    const body = googleEventChanges({
      changes: {
        attendees: [
          { email: "guest@example.com", name: "Guest", optional: true },
        ],
      },
      current,
      meetingRequestId: "meeting-1",
    });
    expect(body).toMatchObject({
      attendees: [{ displayName: "Guest", responseStatus: "accepted" }],
    });
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("start");
  });

  test("marks provider special event types read only", () => {
    const event = toCalendarEvent({
      calendar,
      connectionId: "account-1",
      event: { ...current, eventType: "outOfOffice" },
    });
    expect(event.permissions).toMatchObject({ delete: false, edit: false });
  });

  test("treats legacy confidential events as private and never exposes executable links", () => {
    // oxlint-disable-next-line eslint/no-script-url -- This fixture verifies executable provider URLs are rejected.
    const unsafeUrl = "javascript:alert(1)";
    const event = toCalendarEvent({
      calendar,
      connectionId: "account-1",
      event: {
        ...current,
        hangoutLink: unsafeUrl,
        htmlLink: unsafeUrl,
        visibility: "confidential",
      },
    });
    expect(event.visibility).toBe("private");
    expect(event).not.toHaveProperty("meetingUrl");
    expect(event).not.toHaveProperty("webUrl");
  });

  test("reconciles a retry after insert conflict only for the same draft", async () => {
    let inserted: Record<string, unknown> = {};
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        if (init?.method === "POST") {
          inserted = z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(z.string().parse(init.body)));
          return new Response(null, { status: 409 });
        }
        return Response.json({
          ...current,
          extendedProperties: inserted.extendedProperties,
          id: inserted.id,
        });
      });
    vi.stubGlobal("fetch", request);
    const input = {
      ...auth,
      connectionId: "account-1",
      event: draft,
      operationId: "operation-1",
      userId: "owner-1",
    };
    const event = await createGoogleEvent(input);
    expect(event.id).toMatch(/^[a-f0-9]+$/u);
    expect(event.extendedProperties?.private?.quieterDraft).toBeTruthy();
    request.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 409 })
        : Response.json({
            ...current,
            extendedProperties: {
              private: { quieterDraft: "different-draft" },
            },
            id: inserted.id,
          })
    );
    await expect(
      createGoogleEvent({ ...input, event: { ...draft, title: "Different" } })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("unknown insert outcomes reuse their operation id and check the persisted draft", async () => {
    let inserted: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        if (init?.method === "POST") {
          inserted = z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(z.string().parse(init.body)));
          throw new TypeError("Connection closed after request");
        }
        return Response.json({
          ...current,
          extendedProperties: inserted.extendedProperties,
          id: inserted.id,
        });
      })
    );
    await expect(
      createGoogleEvent({
        ...auth,
        connectionId: "account-1",
        event: draft,
        operationId: "operation-1",
        userId: "owner-1",
      })
    ).resolves.toMatchObject({ summary: "Planning" });
  });

  test("limited writers can edit visible events but cannot change private blocks", () => {
    const shared = {
      ...calendar,
      accessRole: "writerWithoutPrivateAccess" as const,
    };
    const visible = toCalendarEvent({
      calendar: shared,
      connectionId: "account-1",
      event: current,
    });
    const privateBlock = toCalendarEvent({
      calendar: shared,
      connectionId: "account-1",
      event: { ...current, summary: undefined, visibility: "private" },
    });
    expect(visible.permissions).toMatchObject({ delete: true, edit: true });
    expect(privateBlock.permissions).toMatchObject({
      delete: false,
      edit: false,
    });
  });

  test.each([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "quotaExceeded",
    "dailyLimitExceeded",
  ])(
    "classifies %s as quota exhaustion instead of revoked access",
    async (reason) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            Response.json({ error: { errors: [{ reason }] } }, { status: 403 })
          )
      );
      await expect(listGoogleEvents(auth)).rejects.toMatchObject({
        status: 429,
      });
    }
  );

  test("retains permission status for a malformed forbidden response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("Forbidden", { status: 403 }))
    );
    await expect(listGoogleEvents(auth)).rejects.toMatchObject({ status: 403 });
  });
});
