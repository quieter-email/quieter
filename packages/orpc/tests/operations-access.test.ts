/* oxlint-disable eslint/require-await -- Session and database fixtures preserve the asynchronous contracts. */
import { createRouterClient } from "@orpc/server";
import { db } from "@quieter/database/client";
import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { operationsRouter } from "../src/routers/operations";

const fixtures = vi.hoisted(() => ({
  grants: new Set<string>(),
  query:
    vi.fn<
      (sql: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Drizzle's PostgreSQL proxy runs the real authorization query.
vi.mock("@quieter/database/client", async (original) => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    ...(await original<typeof DatabaseClientModule>()),
    db: drizzle(fixtures.query),
  };
});

vi.mock(import("@quieter/auth/session"), async (original) => ({
  ...(await original()),
  getSessionWithOrganization: async (headers: Headers) => {
    const id = headers.get("x-fixture-user");
    const createdAt = new Date("2026-11-11T00:00:00Z");
    return id === null
      ? null
      : {
          session: {
            activeOrganizationId: "fixture-team",
            createdAt,
            expiresAt: new Date("2099-01-01T00:00:00Z"),
            id: `session-${id}`,
            token: "fixture-session-token",
            updatedAt: createdAt,
            userId: id,
          },
          user: {
            createdAt,
            email: `${id}@example.test`,
            emailVerified: true,
            id,
            name: id,
            role: id === "team-admin" ? "admin" : "member",
            updatedAt: createdAt,
          },
        };
  },
}));

vi.mock(import("../src/operations-metrics"), () => ({
  getOperationsOverview: async () => ({
    asOf: "2026-11-11T00:00:00Z",
    daily: [],
    kpis: {
      activeSubscriptions: 0,
      aiUsageEvents: 0,
      completedOnboardingUsers: 0,
      connectedMailboxes: 0,
      totalUsers: 0,
    },
    mailboxMix: { gmail: 0, managedPrivate: 0, managedShared: 0 },
    subscriptionMix: { managed: 0, pro: 0 },
  }),
}));

const operationsFor = (id?: string, contentType = "application/json") => {
  const headers = new Headers({ "content-type": contentType });
  if (id !== undefined) {
    headers.set("x-fixture-user", id);
  }
  return createRouterClient(operationsRouter, { context: { db, headers } });
};

describe("platform operations access", () => {
  beforeEach(() => {
    fixtures.grants.clear();
    fixtures.grants.add("operator");
    const revisions: unknown[][] = [];
    fixtures.query.mockImplementation(async (sql, parameters) => {
      if (sql.includes('from "platformAdmin"')) {
        const [userId] = parameters;
        return {
          rows: [...fixtures.grants]
            .filter((grant) => userId === undefined || grant === userId)
            .map((grant) => [grant]),
        };
      }
      if (sql.startsWith('insert into "waitlistSettingRevision"')) {
        const [actor, waitlistOpen] = parameters;
        revisions.unshift([
          actor,
          "2026-11-11T00:00:00Z",
          revisions.length + 1,
          waitlistOpen,
        ]);
        return { rows: [] };
      }
      if (sql.includes('from "waitlistSettingRevision"')) {
        return { rows: revisions };
      }
      throw new Error("Unexpected operations query.");
    });
  });

  test.each([
    { code: "UNAUTHORIZED", id: undefined },
    { code: "FORBIDDEN", id: "member" },
    { code: "FORBIDDEN", id: "team-admin" },
  ])("protects reads and writes for $id", async ({ code, id }) => {
    const operations = operationsFor(id);
    await Promise.all([
      expect(operations.overview({ days: 7 })).rejects.toMatchObject({ code }),
      expect(operations.settings()).rejects.toMatchObject({ code }),
      expect(
        operations.setWaitlistOpen({ waitlistOpen: false })
      ).rejects.toMatchObject({ code }),
    ]);
    await expect(operationsFor("operator").settings()).resolves.toMatchObject({
      history: [],
    });
  });

  test("allows a platform grant and checks it again after revocation", async () => {
    const operations = operationsFor("operator");
    await expect(operations.overview({ days: 7 })).resolves.toHaveProperty(
      "daily"
    );
    await expect(operations.overview({ days: "all" })).resolves.toHaveProperty(
      "daily"
    );
    await expect(
      operations.setWaitlistOpen({ waitlistOpen: false })
    ).resolves.toMatchObject({
      history: [expect.objectContaining({ actorName: "operator" })],
      waitlistOpen: false,
    });
    await expect(operations.settings()).resolves.toMatchObject({
      waitlistOpen: false,
    });

    fixtures.grants.delete("operator");
    await Promise.all([
      expect(operations.overview({ days: 7 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
      expect(operations.settings()).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
      expect(
        operations.setWaitlistOpen({ waitlistOpen: true })
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    ]);
  });

  test("requires JSON for authenticated waitlist changes", async () => {
    const operations = operationsFor("operator", "text/plain");
    await expect(
      operations.setWaitlistOpen({ waitlistOpen: false })
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    await expect(operations.settings()).resolves.toMatchObject({ history: [] });
  });
});
