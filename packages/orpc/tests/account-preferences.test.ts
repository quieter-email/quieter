import { call } from "@orpc/server";
import { db } from "@quieter/database/client";
import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { accountPreferencesRouter } from "../src/routers/account-preferences";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The test session only needs the protected procedure's identity contract.
vi.mock("@quieter/auth/session", () => ({
  // oxlint-disable-next-line require-await -- Preserve the asynchronous session API in this fixture.
  getSessionWithOrganization: async () =>
    mocks.authenticated
      ? {
          session: { id: "session" },
          user: {
            email: "test@example.com",
            id: "acting-user",
            name: "Test",
          },
        }
      : null,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The SQL proxy executes the same queries without a live database.
vi.mock("@quieter/database/client", async (original) => {
  const actual = await original<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});

const context = { db, headers: new Headers({ "accept-language": "en-US" }) };

describe("account date and time preferences", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticated = true;
  });

  test("rejects unauthenticated reads and writes before database access", async () => {
    mocks.authenticated = false;
    await expect(
      call(accountPreferencesRouter.get, undefined, { context })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      call(accountPreferencesRouter.update, { timeFormat: "24h" }, { context })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  test("scopes reads to the authenticated user and preserves saved choices", async () => {
    mocks.query.mockResolvedValue({ rows: [["24h", 0]] });
    await expect(
      call(accountPreferencesRouter.get, undefined, { context })
    ).resolves.toMatchObject({ timeFormat: "24h", weekStartsOn: 0 });
    for (const [query, params] of mocks.query.mock.calls) {
      expect(query).toMatch(/where "user"\."id" =/u);
      expect(params).toContain("acting-user");
      expect(query).not.toMatch(/^update/u);
    }
  });

  test("limits partial writes to the authenticated user's selected field", async () => {
    mocks.query.mockResolvedValue({ rows: [["24h", 6]] });
    await call(
      accountPreferencesRouter.update,
      { weekStartsOn: 6 },
      { context }
    );
    const [query, params] = mocks.query.mock.calls[0] ?? [];
    expect(query).toMatch(/set "weekStartsOn" = .* where "user"\."id" =/u);
    expect(query).not.toMatch(/set "timeFormat"/u);
    expect(params).toContain("acting-user");
  });

  test("initializes legacy regional defaults without overwriting a concurrent explicit choice", async () => {
    let reads = 0;
    // oxlint-disable-next-line require-await -- The SQL proxy requires an asynchronous result.
    mocks.query.mockImplementation(async (query) => {
      if (query.startsWith("select")) {
        reads += 1;
        return {
          rows: reads === 1 ? [[null, null]] : [["24h", 0]],
        };
      }
      expect(query).toMatch(
        /where.*"user"\."id" = .* and .*"user"\."timeFormat" is null/u
      );
      return { rows: [] };
    });
    await expect(
      call(accountPreferencesRouter.get, undefined, { context })
    ).resolves.toMatchObject({ timeFormat: "24h", weekStartsOn: 0 });
  });
});
