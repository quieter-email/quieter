import { ORPCError } from "@orpc/server";
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
  respondToCalendarEventForUser,
  updateCalendarEventForUser,
  updateCalendarColorForUser,
} from "../src/calendar/service";
import { CALENDAR_SCOPES } from "../src/gmail-mailbox-access";
import type { PreparedGmailMailboxIdentity } from "../src/gmail-mailbox-access";

const mocks = vi.hoisted(() => {
  const env: {
    allowlist: string;
    deployment: "local" | "production";
    mode: "observe" | "write";
  } = { allowlist: "", deployment: "local", mode: "observe" };
  return {
    accountEmail: "owner@example.com",
    env,
    googleSubject: "owned-subject",
    query:
      vi.fn<
        (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
      >(),
    scopes: "",
    status: "connected",
  };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy verifies the ownership predicates used by Drizzle.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  return {
    ...actual,
    db: Object.assign(database, {
      transaction: async <Result>(
        run: (reader: typeof database) => Promise<Result>
      ) => await run(database),
    }),
  };
});
vi.mock(import("../src/gmail-mailbox-access"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAuthorizedGmailMailbox: async <T>(
      input: Parameters<typeof actual.runAuthorizedGmailMailbox>[0],
      run: (token: string, identity: PreparedGmailMailboxIdentity) => Promise<T>
    ): Promise<T> =>
      await run("owned-test-token", {
        googleSubject: mocks.googleSubject,
        mailboxId: input.mailboxId,
      }),
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
    mocks.googleSubject = "owned-subject";
    mocks.scopes = CALENDAR_SCOPES.join(" ");
    mocks.status = "connected";
    mocks.query.mockReset().mockImplementation(async (query) => {
      if (query.includes('from "connectorCredential"')) {
        return { rows: [] };
      }
      if (query.includes('select "gmailCredential"."googleSubject"')) {
        return { rows: [[mocks.googleSubject, mocks.scopes, mocks.status]] };
      }
      return {
        rows: [
          [
            null,
            mocks.accountEmail,
            mocks.googleSubject,
            reference.connectionId,
            mocks.scopes,
            mocks.status,
          ],
        ],
      };
    });
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
    const mutation = request.mock.calls.find(
      ([, init]) => init?.method === "PATCH"
    );
    expect(mutation?.[0]).toContain("sendUpdates=all");
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

  test.each(["policy", "booking", "abort"])(
    "a rejected %s guard cannot recover a previous calendar create",
    async (reason) => {
      const storedEventSchema = z.object({
        extendedProperties: z.object({
          private: z.object({ quieterDraft: z.string() }),
        }),
        id: z.string(),
      });
      let stored: z.infer<typeof storedEventSchema> | undefined;
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (new Request(url).url.includes("calendarList")) {
            return Response.json(calendar);
          }
          if (init?.method === "POST") {
            stored = storedEventSchema.parse(
              JSON.parse(z.string().parse(init.body))
            );
          }
          return Response.json({ ...event, ...stored });
        });
      vi.stubGlobal("fetch", request);
      const input = {
        ...reference,
        event: draft,
        operationId: "d2d2a899-ed59-475e-a806-c8e42b847e9a",
      };
      await expect(createCalendarEventForUser(input)).resolves.toMatchObject({
        action: "created",
      });
      request.mockClear();
      const cancellation = new AbortController();
      const denial = new ORPCError(
        reason === "booking" ? "CONFLICT" : "FORBIDDEN"
      );
      await expect(
        createCalendarEventForUser({
          ...input,
          authorityMailboxId: "assistant-inbox",
          beforeEffect: async () => {
            if (reason === "abort") {
              cancellation.abort(denial);
              return;
            }
            throw denial;
          },
          signal: cancellation.signal,
        })
      ).rejects.toBe(denial);
      expect(
        request.mock.calls.filter(([, init]) => init?.method === "POST")
      ).toHaveLength(0);
      expect(
        request.mock.calls.filter(([url]) =>
          new Request(url).url.includes("/events/")
        )
      ).toHaveLength(0);
    }
  );

  test("an attempted ambiguous calendar create can recover the matching prior event", async () => {
    const storedEventSchema = z.object({
      extendedProperties: z.object({
        private: z.object({ quieterDraft: z.string() }),
      }),
      id: z.string(),
    });
    let stored: z.infer<typeof storedEventSchema> | undefined;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        if (new Request(url).url.includes("calendarList")) {
          return Response.json(calendar);
        }
        if (init?.method === "POST") {
          stored = storedEventSchema.parse(
            JSON.parse(z.string().parse(init.body))
          );
          throw new TypeError(
            "The connection closed after accepting the event."
          );
        }
        return Response.json({ ...event, ...stored });
      });
    vi.stubGlobal("fetch", request);
    const result = await createCalendarEventForUser({
      ...reference,
      event: draft,
      operationId: "d2d2a899-ed59-475e-a806-c8e42b847e9a",
    });
    expect(result).toMatchObject({ action: "created", eventId: stored?.id });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(1);
    expect(
      request.mock.calls.filter(([url]) =>
        new Request(url).url.includes("/events/")
      )
    ).toHaveLength(1);
  });

  test.each(["denied", "attempted"])(
    "calendar invitation recovery requires an attempted POST when the write is %s",
    async (phase) => {
      let lookups = 0;
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (new Request(url).url.includes("calendarList")) {
            return Response.json(calendar);
          }
          if (init?.method === "POST") {
            throw new TypeError(
              "The connection closed after accepting the invitation."
            );
          }
          lookups += 1;
          return Response.json({ items: lookups === 1 ? [] : [event] });
        });
      vi.stubGlobal("fetch", request);
      const denial = new ORPCError("FORBIDDEN");
      const result = importCalendarInvitationForUser({
        ...reference,
        authorityMailboxId: "assistant-inbox",
        beforeEffect: async () => {
          if (phase === "denied") {
            throw denial;
          }
        },
        event: {
          end: { date: "2026-10-24" },
          start: { date: "2026-10-23" },
          summary: "Invitation",
        },
        fallbackUid: "invitation-1",
      });
      const [outcome] = await Promise.allSettled([result]);
      expect(outcome).toMatchObject(
        phase === "denied"
          ? { reason: denial, status: "rejected" }
          : { status: "fulfilled", value: { id: event.id, status: "success" } }
      );
      const failure: unknown =
        outcome?.status === "rejected" ? outcome.reason : undefined;
      expect(failure).toBe(phase === "denied" ? denial : undefined);
      expect(lookups).toBe(phase === "denied" ? 1 : 2);
      expect(
        request.mock.calls.filter(([, init]) => init?.method === "POST")
      ).toHaveLength(phase === "denied" ? 0 : 1);
    }
  );

  test("a policy change during color preparation prevents the final calendar write", async () => {
    const started = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    let blocked = false;
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (new Request(url).url.endsWith("/colors")) {
        started.resolve(true);
        await release.promise;
        return Response.json({
          calendar: {},
          event: { "1": { background: "#123456", foreground: "#ffffff" } },
        });
      }
      return Response.json(calendar);
    });
    vi.stubGlobal("fetch", request);
    const result = createCalendarEventForUser({
      ...reference,
      authorityMailboxId: "assistant-inbox",
      beforeEffect: async () => {
        if (blocked) {
          throw new ORPCError("FORBIDDEN");
        }
      },
      event: { ...draft, color: "#123456" },
      operationId: "d2d2a899-ed59-475e-a806-c8e42b847e9a",
    });
    await started.promise;
    blocked = true;
    release.resolve(true);
    await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      request.mock.calls.some(([, init]) => init?.method !== undefined)
    ).toBeFalsy();
  });

  test("a calendar permission revoked during event preparation prevents the write", async () => {
    let accessRole = "owner";
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (new Request(url).url.includes("calendarList")) {
        return Response.json({ ...calendar, accessRole });
      }
      accessRole = "reader";
      return Response.json({ ...event, organizer: { self: true } });
    });
    vi.stubGlobal("fetch", request);
    await expect(
      updateCalendarEventForUser({
        ...reference,
        changes: { title: "Changed" },
        version: event.etag,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      request.mock.calls.some(([, init]) => init?.method !== undefined)
    ).toBeFalsy();
  });

  test.each(["permission-read", "caller-preparation"])(
    "an account disconnected during final %s cannot write",
    async (phase) => {
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      let connected = true;
      let eventPrepared = false;
      mocks.query.mockImplementation(async (query) => {
        if (query.includes('from "connectorCredential"')) {
          return { rows: [] };
        }
        const status = connected ? "connected" : "needs_reconnect";
        if (query.includes('select "gmailCredential"."googleSubject"')) {
          return {
            rows: [["owned-subject", CALENDAR_SCOPES.join(" "), status]],
          };
        }
        return {
          rows: [
            [
              null,
              mocks.accountEmail,
              "owned-subject",
              reference.connectionId,
              CALENDAR_SCOPES.join(" "),
              status,
            ],
          ],
        };
      });
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (new Request(url).url.includes("calendarList")) {
            if (eventPrepared && phase === "permission-read") {
              started.resolve(true);
              await release.promise;
            }
            return Response.json(calendar);
          }
          if (init?.method === "PATCH") {
            return Response.json(event);
          }
          eventPrepared = true;
          return Response.json({ ...event, organizer: { self: true } });
        });
      vi.stubGlobal("fetch", request);
      const result = updateCalendarEventForUser({
        ...reference,
        authorityMailboxId: "assistant-inbox",
        changes: { title: "Changed" },
        prepareEffect: async () => {
          if (phase === "caller-preparation") {
            started.resolve(true);
            await release.promise;
          }
        },
        version: event.etag,
      });
      await started.promise;
      connected = false;
      release.resolve(true);
      await expect(result).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(
        request.mock.calls.some(([, init]) => init?.method !== undefined)
      ).toBeFalsy();
    }
  );

  test.each([
    { change: "scope-revocation", googleSubject: "owned-subject", scopes: "" },
    {
      change: "same-mailbox-account-replacement",
      googleSubject: "replacement-subject",
      scopes: CALENDAR_SCOPES.join(" "),
    },
  ])(
    "$change during final calendar preparation cannot reuse the prepared token",
    async ({ googleSubject, scopes }) => {
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      let eventPrepared = false;
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (new Request(url).url.includes("calendarList")) {
            if (eventPrepared) {
              started.resolve(true);
              await release.promise;
            }
            return Response.json(calendar);
          }
          if (init?.method === "PATCH") {
            return Response.json(event);
          }
          eventPrepared = true;
          return Response.json({ ...event, organizer: { self: true } });
        });
      vi.stubGlobal("fetch", request);
      const result = updateCalendarEventForUser({
        ...reference,
        changes: { title: "Changed" },
        version: event.etag,
      });
      await started.promise;
      mocks.scopes = scopes;
      mocks.googleSubject = googleSubject;
      release.resolve(true);
      await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        request.mock.calls.some(([, init]) => init?.method !== undefined)
      ).toBeFalsy();
    }
  );
});
