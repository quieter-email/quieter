/* oxlint-disable eslint/require-await -- Fetch and SQL test doubles preserve asynchronous transport contracts. */
import { calendarEventDraftSchema } from "@quieter/calendar";
import type * as DatabaseClientModule from "@quieter/database/client";
import type { gmailCredential, mailbox } from "@quieter/database/schema";
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
import { CALENDAR_SCOPES } from "../src/gmail-mailbox-access";

type Credential = Pick<
  typeof gmailCredential.$inferSelect,
  | "accessTokenExpiresAt"
  | "encryptedAccessToken"
  | "encryptedRefreshToken"
  | "googleSubject"
  | "scopes"
> &
  Pick<
    typeof mailbox.$inferSelect,
    "emailAddress" | "id" | "ownerUserId" | "status"
  >;

const fixtures = vi.hoisted(() => ({
  credentials: [] as Credential[],
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy exercises the actual ownership and account predicates.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(fixtures.query) };
});

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
    fixtures.credentials = ["first", "selected"].map((id): Credential => ({
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      emailAddress: `${id}@example.test`,
      encryptedAccessToken: `${id}-access`,
      encryptedRefreshToken: `${id}-refresh`,
      googleSubject: `${id}-subject`,
      id: `mailbox-${id}`,
      ownerUserId: "owner",
      scopes: CALENDAR_SCOPES.join(" "),
      status: "connected",
    }));
    fixtures.query.mockReset().mockImplementation(async (query, params) => {
      if (query.startsWith("update")) {
        return { rows: [["mailbox-selected"]] };
      }
      if (query.includes('from "connectorCredential"')) {
        if (!params.includes("owner")) {
          return { rows: [] };
        }
        if (query.includes('"accessTokenExpiresAt"')) {
          return {
            rows: params.includes("selected")
              ? []
              : [
                  [
                    new Date("2099-01-01T00:00:00Z"),
                    "linear-access",
                    "linear-refresh",
                    "linear",
                    "linear",
                    "read write",
                    "connected",
                  ],
                ],
          };
        }
        return {
          rows: fixtures.credentials.map((record) => [
            record.emailAddress,
            null,
            record.id.replace("mailbox-", ""),
            record.googleSubject,
          ]),
        };
      }
      const owned = fixtures.credentials.filter((record) =>
        params.includes(record.ownerUserId)
      );
      if (query.includes('"accessTokenExpiresAt"')) {
        return {
          rows: owned
            .filter((record) => params.includes(record.id))
            .map((record) => [
              record.accessTokenExpiresAt,
              record.emailAddress,
              record.encryptedAccessToken,
              record.encryptedRefreshToken,
              record.id,
              record.scopes,
              record.status,
            ]),
        };
      }
      return {
        rows: owned.map((record) => [
          null,
          record.emailAddress,
          record.googleSubject,
          record.id,
          record.scopes,
          record.status,
        ]),
      };
    });
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
      fixtures.credentials.find((record) => record.id === "mailbox-first")
        ?.encryptedAccessToken
    ).toBe("first-access");
  });

  test("refreshes expired authorization upfront but never replays a background mutation", async () => {
    const selected = fixtures.credentials.find(
      (record) => record.id === "mailbox-selected"
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
