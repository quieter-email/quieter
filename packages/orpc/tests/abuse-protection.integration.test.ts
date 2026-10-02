import { db } from "@quieter/database/client";
import { rateLimitBucket } from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  cleanupRateLimitBuckets,
  consumeRateLimit,
} from "../src/abuse-protection";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "rate limit persistence",
  () => {
    const activeKey = crypto.randomUUID();
    const expiredKey = crypto.randomUUID();
    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Rate limit integration tests require loopback quieter_migration_test."
        );
      }
    });

    afterAll(async () => {
      await db
        .delete(rateLimitBucket)
        .where(inArray(rateLimitBucket.key, [activeKey, expiredKey]));
      await db.$client.end();
    });

    test("enforces concurrent limits and deletes expired identities without resetting active quotas", async () => {
      const results = await Promise.all(
        Array.from(
          { length: 40 },
          async () =>
            await consumeRateLimit({
              key: activeKey,
              limit: 20,
              windowMs: 60_000,
            })
        )
      );
      expect(results.filter((result) => result.allowed)).toHaveLength(20);
      await db.insert(rateLimitBucket).values({
        count: 7,
        expiresAt: new Date(0),
        key: expiredKey,
        windowStart: new Date(0),
      });
      await cleanupRateLimitBuckets();
      await expect(
        db
          .select()
          .from(rateLimitBucket)
          .where(eq(rateLimitBucket.key, expiredKey))
      ).resolves.toHaveLength(0);
      const afterCleanup = await consumeRateLimit({
        key: activeKey,
        limit: 20,
        windowMs: 60_000,
      });
      expect(afterCleanup.allowed).toBeFalsy();
      expect(afterCleanup.remaining).toBe(0);
    });
  }
);
