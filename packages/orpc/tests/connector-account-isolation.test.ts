/* oxlint-disable eslint/require-await -- Fetch test doubles keep the async contract without network I/O. */
import { calendarEventDraftSchema } from "@quieter/calendar";
import type { connectorCredential } from "@quieter/database/schema";
import type * as drizzleOrm from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  createCalendarEventForUser,
  listCalendarEventsForUser,
} from "../src/calendar/service";
import { getLinearAccessTokenForUser } from "../src/connectors/runtime";

type Credential = Pick<
  typeof connectorCredential.$inferSelect,
  | "accessTokenExpiresAt"
  | "encryptedAccessToken"
  | "encryptedRefreshToken"
  | "id"
  | "provider"
  | "scopes"
  | "status"
  | "userId"
>;
type Predicate = (row: Credential) => boolean;

const fixtures = vi.hoisted(() => {
  const credentials: Credential[] = [];
  return { credentials };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake evaluates credential predicates against isolated account records.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof drizzleOrm>()),
  and:
    (...predicates: (Predicate | undefined)[]) =>
    (row: Credential) =>
      predicates.every((predicate) => predicate?.(row) ?? true),
  eq: (column: { name: string }, value: unknown) => (row: Credential) =>
    Object.entries(row).some(
      ([name, current]) => name === column.name && current === value
    ),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake implements only credential query methods.
vi.mock("@quieter/database/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: Predicate) => ({
          limit: (limit: number) =>
            fixtures.credentials.filter(predicate).slice(0, limit),
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<Credential>) => ({
        where: (predicate: Predicate) => {
          for (const record of fixtures.credentials.filter(predicate)) {
            Object.assign(record, values);
          }
        },
      }),
    }),
  },
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireServerEnv: () => "fixture-client",
    serverEnv: {
      ...actual.serverEnv,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: (value: string) => value,
  encryptGmailCredentialSecret: (value: string) => value,
}));

const event = calendarEventDraftSchema.parse({
  time: {
    endDate: "2026-11-02",
    kind: "all-day",
    startDate: "2026-11-01",
  },
  title: "Account isolation",
});
const calendar = {
  accessRole: "owner",
  id: "primary",
  primary: true,
  timeZone: "Europe/Berlin",
};
const providerEvent = {
  end: { date: "2026-11-02" },
  etag: '"event-version"',
  id: "owned-event",
  start: { date: "2026-11-01" },
  status: "confirmed",
  summary: "Account isolation",
};
const range = {
  calendarId: "primary",
  end: "2026-11-02T00:00:00Z",
  start: "2026-11-01T00:00:00Z",
  timeZone: "Europe/Berlin",
};

describe("connector account authority", () => {
  beforeEach(() => {
    fixtures.credentials.length = 0;
    fixtures.credentials.push(
      ...["first", "selected"].map((id): Credential => ({
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        encryptedAccessToken: `${id}-access`,
        encryptedRefreshToken: `${id}-refresh`,
        id,
        provider: "google_calendar",
        scopes:
          "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        status: "connected",
        userId: "owner",
      })),
      {
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        encryptedAccessToken: "linear-access",
        encryptedRefreshToken: "linear-refresh",
        id: "linear",
        provider: "linear",
        scopes: "read write",
        status: "connected",
        userId: "owner",
      }
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  test("selects the exact owned account and preserves the omitted-id API", async () => {
    const tokens: string[] = [];
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        tokens.push(new Headers(init?.headers).get("authorization") ?? "");
        return Response.json(
          new Request(url).url.includes("calendarList")
            ? calendar
            : { items: [providerEvent] }
        );
      });
    vi.stubGlobal("fetch", request);
    await expect(
      listCalendarEventsForUser({
        ...range,
        connectionId: "selected",
        userId: "owner",
      })
    ).resolves.toMatchObject({
      events: [{ connectionId: "selected", eventId: "owned-event" }],
    });
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens)).toStrictEqual(new Set(["Bearer selected-access"]));
    await expect(
      getLinearAccessTokenForUser({ userId: "owner" })
    ).resolves.toBe("linear-access");
  });

  test("never substitutes another account for a missing, foreign, or wrong-provider id", async () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    for (const input of [
      { connectionId: "missing", userId: "owner" },
      { connectionId: "selected", userId: "another-user" },
      { connectionId: "linear", userId: "owner" },
    ]) {
      await expect(
        listCalendarEventsForUser({ ...range, ...input })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      getLinearAccessTokenForUser({ connectionId: "selected", userId: "owner" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(request).not.toHaveBeenCalled();
  });

  test("keeps a retry bound to the selected account through token refresh", async () => {
    const tokens: string[] = [];
    const refreshTokens: string[] = [];
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        if (url === "https://oauth2.googleapis.com/token") {
          if (init?.body instanceof URLSearchParams) {
            refreshTokens.push(init.body.get("refresh_token") ?? "");
          }
          return Response.json({
            access_token: "renewed-selected",
            expires_in: 3600,
            token_type: "Bearer",
          });
        }
        if (init?.method !== "POST") {
          return Response.json(calendar);
        }
        tokens.push(new Headers(init?.headers).get("authorization") ?? "");
        return tokens.length === 1
          ? Response.json({ error: { message: "Expired" } }, { status: 401 })
          : Response.json({ ...providerEvent, id: "created-event" });
      });
    vi.stubGlobal("fetch", request);
    await expect(
      createCalendarEventForUser({
        calendarId: "primary",
        connectionId: "selected",
        event,
        operationId: "da1bc703-f81e-4b6e-9e4c-428123b4d2a1",
        userId: "owner",
      })
    ).resolves.toMatchObject({
      connectionId: "selected",
      eventId: "created-event",
      status: "success",
    });
    expect(tokens).toStrictEqual([
      "Bearer selected-access",
      "Bearer renewed-selected",
    ]);
    expect(refreshTokens).toStrictEqual(["selected-refresh"]);
    expect(
      fixtures.credentials.find((record) => record.id === "first")
        ?.encryptedAccessToken
    ).toBe("first-access");
  });

  test("refreshes expired authorization upfront but never replays a background mutation", async () => {
    const selected = fixtures.credentials.find(
      (record) => record.id === "selected"
    );
    if (selected === undefined) {
      throw new Error("Missing selected credential.");
    }
    selected.accessTokenExpiresAt = new Date(0);
    let mutations = 0;
    let refreshes = 0;
    const mutationTokens: string[] = [];
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        if (url === "https://oauth2.googleapis.com/token") {
          refreshes += 1;
          return Response.json({
            access_token: "renewed-selected",
            expires_in: 3600,
            token_type: "Bearer",
          });
        }
        if (init?.method !== "POST") {
          return Response.json(calendar);
        }
        mutations += 1;
        mutationTokens.push(
          new Headers(init?.headers).get("authorization") ?? ""
        );
        return Response.json(
          { error: { message: "Unauthorized" } },
          { status: 401 }
        );
      });
    vi.stubGlobal("fetch", request);
    await expect(
      createCalendarEventForUser({
        calendarId: "primary",
        connectionId: "selected",
        event,
        operationId: "da1bc703-f81e-4b6e-9e4c-428123b4d2a1",
        retryUnauthorized: false,
        userId: "owner",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(refreshes).toBe(1);
    expect(mutations).toBe(1);
    expect(mutationTokens).toStrictEqual(["Bearer renewed-selected"]);
  });
});
