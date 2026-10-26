/* oxlint-disable eslint/require-await -- Fetch and SQL mocks preserve asynchronous transport contracts. */
import { calendarEventDraftSchema } from "@quieter/calendar";
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

import {
  createCalendarEventForUser,
  deleteCalendarEventForUser,
  getCalendarEventForUser,
  importCalendarInvitationForUser,
  listCalendarEventsForUser,
  respondToCalendarEventForUser,
  updateCalendarEventForUser,
  updateCalendarColorForUser,
} from "../src/calendar/service";
import { CALENDAR_SCOPES } from "../src/gmail-mailbox-access";

const mocks = vi.hoisted(() => {
  const env: {
    allowlist: string;
    deployment: "local" | "production";
    mode: "observe" | "write";
  } = { allowlist: "", deployment: "local", mode: "observe" };
  return {
    accountEmail: "owner@example.com",
    env,
    query:
      vi.fn<
        (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
      >(),
  };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy verifies the ownership predicates used by Drizzle.
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
      _input: Parameters<typeof actual.runAuthorizedGmailMailbox>[0],
      run: (token: string) => Promise<T>
    ): Promise<T> => await run("owned-test-token"),
  };
});
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get QUIETER_DEPLOYMENT_ENV() {
        return mocks.env.deployment;
      },
      get QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS() {
        return mocks.env.allowlist;
      },
      get QUIETER_LOCAL_PROVIDER_MODE() {
        return mocks.env.mode;
      },
    },
  };
});
const reference = {
  calendarId: "team-calendar",
  connectionId: "connection-1",
  eventId: "instance-id",
  userId: "owner-1",
};
const calendar = {
  accessRole: "owner",
  id: reference.calendarId,
  timeZone: "UTC",
};
const event = {
  attendees: [
    { email: "owner@example.com", responseStatus: "needsAction", self: true },
    { email: "other@example.com", responseStatus: "accepted" },
  ],
  end: { date: "2026-10-24" },
  etag: '"version-1"',
  id: reference.eventId,
  organizer: { email: "other@example.com", self: false },
  start: { date: "2026-10-23" },
  summary: "Invitation",
};
const draft = calendarEventDraftSchema.parse({
  time: { endDate: "2026-10-24", kind: "all-day", startDate: "2026-10-23" },
  title: "Planning",
});

describe("calendar account isolation and mutations", () => {
  beforeEach(() => {
    mocks.env.mode = "write";
    mocks.env.allowlist = `owner@example.com,${reference.calendarId}`;
    mocks.env.deployment = "local";
    mocks.query.mockReset().mockImplementation(async (query) => ({
      rows: query.includes('from "connectorCredential"')
        ? []
        : [
            [
              null,
              mocks.accountEmail,
              "owned-subject",
              reference.connectionId,
              CALENDAR_SCOPES.join(" "),
              "connected",
            ],
          ],
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  test("rejects foreign connections before calling the provider", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(getCalendarEventForUser(reference)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(request).not.toHaveBeenCalled();
    const [query, values] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('"mailbox"."ownerUserId" =');
    expect(query).toContain('"mailbox"."provider" =');
    expect(values).toContain(reference.userId);
    expect(values).toContain("gmail");
  });

  test("every mutation requires local write mode before any provider request", async () => {
    mocks.env.mode = "observe";
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const operations = [
      createCalendarEventForUser({
        ...reference,
        event: draft,
        operationId: "d2d2a899-ed59-475e-a806-c8e42b847e9a",
      }),
      updateCalendarEventForUser({
        ...reference,
        changes: { title: "Changed" },
        version: event.etag,
      }),
      deleteCalendarEventForUser({ ...reference, version: event.etag }),
      respondToCalendarEventForUser({
        ...reference,
        response: "accepted",
        version: event.etag,
      }),
      updateCalendarColorForUser({ ...reference, color: "#123456" }),
    ];
    const results = await Promise.allSettled(operations);
    for (const result of results) {
      expect(result).toMatchObject({
        reason: { code: "FORBIDDEN" },
        status: "rejected",
      });
    }
    expect(request).not.toHaveBeenCalled();
  });

  test("calendar color preferences stay owner scoped and support subscribed read-only calendars", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body: unknown =
          typeof init?.body === "string"
            ? JSON.parse(z.string().parse(init.body))
            : undefined;
        return Response.json({
          ...calendar,
          accessRole: "reader",
          ...(init?.method === "PATCH"
            ? {
                backgroundColor: z
                  .object({ backgroundColor: z.string() })
                  .parse(body).backgroundColor,
              }
            : {}),
        });
      });
    vi.stubGlobal("fetch", request);
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      updateCalendarColorForUser({ ...reference, color: "#123456" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(request).not.toHaveBeenCalled();
    mocks.env.allowlist = "owner@example.com";
    await expect(
      updateCalendarColorForUser({ ...reference, color: "#123456" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      request.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBeFalsy();
    mocks.env.allowlist = `owner@example.com,${reference.calendarId}`;
    await expect(
      updateCalendarColorForUser({ ...reference, color: "#123456" })
    ).resolves.toMatchObject({
      access: "read",
      calendarId: reference.calendarId,
      color: "#123456",
      connectionId: reference.connectionId,
    });
    const [url, init] =
      request.mock.calls.find(([, entry]) => entry?.method === "PATCH") ?? [];
    expect(url).toContain(
      "/users/me/calendarList/team-calendar?colorRgbFormat=true"
    );
    expect(JSON.parse(z.string().parse(init?.body))).toMatchObject({
      backgroundColor: "#123456",
    });
  });

  test("reads, event writes, replies, and imported invitations keep the same resolved event color", async () => {
    const colored = {
      ...event,
      colorId: "event-color",
      organizer: { self: true },
    };
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = new URL(new Request(url).url);
      if (target.pathname.includes("calendarList")) {
        return Response.json({ ...calendar, backgroundColor: "#654321" });
      }
      if (target.pathname.endsWith("/colors")) {
        return Response.json({
          calendar: {},
          event: {
            "event-color": { background: "#123456", foreground: "#ffffff" },
          },
        });
      }
      return Response.json(
        target.pathname.endsWith("/events")
          ? { ...colored, items: [colored] }
          : colored
      );
    });
    vi.stubGlobal("fetch", request);
    const resolved = { color: "#123456", colorOverride: "#123456" };
    await expect(getCalendarEventForUser(reference)).resolves.toMatchObject(
      resolved
    );
    await expect(
      listCalendarEventsForUser({
        ...reference,
        end: "2026-10-25T00:00:00Z",
        start: "2026-10-20T00:00:00Z",
        timeZone: "UTC",
      })
    ).resolves.toMatchObject({ events: [resolved] });
    await expect(
      createCalendarEventForUser({
        ...reference,
        event: { ...draft, color: "#123456" },
        operationId: "d2d2a899-ed59-475e-a806-c8e42b847e9a",
      })
    ).resolves.toMatchObject({ event: resolved });
    await expect(
      updateCalendarEventForUser({
        ...reference,
        changes: { color: "#123456" },
        version: event.etag,
      })
    ).resolves.toMatchObject({ event: resolved });
    await expect(
      respondToCalendarEventForUser({
        ...reference,
        response: "accepted",
        version: event.etag,
      })
    ).resolves.toMatchObject({ event: resolved });
    await expect(
      importCalendarInvitationForUser({
        ...reference,
        event: { end: event.end, start: event.start, summary: event.summary },
        fallbackUid: "imported-event",
      })
    ).resolves.toMatchObject({ event: resolved });
    const writes = request.mock.calls
      .filter(([, init]) => init?.method === "POST" || init?.method === "PATCH")
      .map(([, init]) => {
        const body: unknown = JSON.parse(z.string().parse(init?.body));
        return body;
      });
    expect(writes).toContainEqual(
      expect.objectContaining({ colorId: "event-color" })
    );
  });

  test("requires actual credential email and separately allows shared targets", async () => {
    mocks.env.allowlist = "other@example.com";
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ ...calendar, accessRole: "writer" })
      );
    vi.stubGlobal("fetch", request);
    const input = { ...reference, version: event.etag };
    await expect(deleteCalendarEventForUser(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(request).not.toHaveBeenCalled();
    mocks.env.allowlist = "owner@example.com";
    await expect(deleteCalendarEventForUser(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBeTruthy();
  });

  test("rejects stale changes before writing and sends If-Match for current edits", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        if (new Request(url).url.includes("calendarList")) {
          return Response.json(calendar);
        }
        if (init?.method === "PATCH") {
          return new Response(null, { status: 412 });
        }
        return Response.json({ ...event, organizer: { self: true } });
      });
    vi.stubGlobal("fetch", request);
    await expect(
      updateCalendarEventForUser({
        ...reference,
        changes: { title: "Changed" },
        version: '"old-version"',
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBeTruthy();
    await expect(
      updateCalendarEventForUser({
        ...reference,
        changes: { title: "Changed" },
        version: event.etag,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const mutation = request.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    );
    expect(mutation?.[0]).toContain("instance-id");
    expect(new Headers(mutation?.[1]?.headers).get("If-Match")).toBe(
      event.etag
    );
  });

  test("RSVP patches only the actual self attendee and preserves other responses", async () => {
    let body: unknown;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        if (new Request(url).url.includes("calendarList")) {
          return Response.json(calendar);
        }
        if (init?.method === "PATCH") {
          body = JSON.parse(z.string().parse(init.body));
          return Response.json(event);
        }
        return Response.json(event);
      });
    vi.stubGlobal("fetch", request);
    await respondToCalendarEventForUser({
      ...reference,
      response: "accepted",
      version: event.etag,
    });
    expect(body).toMatchObject({
      attendees: [{ email: "owner@example.com", responseStatus: "accepted" }],
      attendeesOmitted: true,
    });
    request.mockImplementation(async (url) =>
      Response.json(
        new Request(url).url.includes("calendarList")
          ? calendar
          : {
              ...event,
              attendees: [{ email: "other@example.com", self: false }],
            }
      )
    );
    await expect(
      respondToCalendarEventForUser({
        ...reference,
        response: "accepted",
        version: event.etag,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("local manager access still requires an explicitly allowed non-primary calendar", async () => {
    mocks.env.allowlist = "owner@example.com";
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        if (new Request(url).url.includes("calendarList")) {
          return Response.json(calendar);
        }
        if (init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return Response.json(event);
      });
    vi.stubGlobal("fetch", request);
    await expect(
      deleteCalendarEventForUser({ ...reference, version: event.etag })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBeTruthy();
    mocks.env.allowlist = `owner@example.com,${reference.calendarId}`;
    await expect(
      deleteCalendarEventForUser({ ...reference, version: event.etag })
    ).resolves.toMatchObject({ action: "deleted" });
  });

  test("calendar quota errors remain retryable instead of becoming permission failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
            { status: 403 }
          )
        )
    );
    await expect(getCalendarEventForUser(reference)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      status: 429,
    });
  });
});
