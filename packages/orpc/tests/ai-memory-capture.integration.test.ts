import { db } from "@quieter/database/client";
import {
  aiMemoryScopeConfig,
  mailbox,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  learnAiMemoryFromFeedback,
  purgePersonalAiMemory,
} from "../src/ai-memory";

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
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "personal observation capture on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const control = postgres(state.databaseUrl ?? "", { max: 1 });
    const observation = {
      kind: "mail_action" as const,
      mailboxId,
      metadata: { action: "read", targetCount: 1 },
      userId,
    };

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Memory capture integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Memory capture test",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Memory capture test",
        slug: organizationId,
      });
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: "memory-capture@example.test",
        id: mailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await control.end();
      await db.$client.end();
    });

    test("finishes capture before reset can delete observations", async () => {
      const locked = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const blocker = control.begin(async (tx) => {
        await tx`LOCK TABLE "userAiContextEvent" IN SHARE MODE`;
        locked.resolve(true);
        await release.promise;
      });
      await locked.promise;
      let capture: ReturnType<typeof learnAiMemoryFromFeedback> | undefined;
      let reset: ReturnType<typeof purgePersonalAiMemory> | undefined;
      try {
        capture = learnAiMemoryFromFeedback(observation);
        await expect
          .poll(async () => {
            const rows = await db.$client<{ waiting: boolean }[]>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database()
                  AND wait_event_type = 'Lock'
                  AND query LIKE 'insert into "userAiContextEvent"%'
              ) AS waiting
            `;
            return rows[0]?.waiting;
          })
          .toBeTruthy();
        reset = purgePersonalAiMemory(userId);
        await expect
          .poll(async () => {
            const rows = await db.$client<{ waiting: boolean }[]>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database()
                  AND wait_event_type = 'Lock'
                  AND query LIKE 'select%from "user"%for update%'
              ) AS waiting
            `;
            return rows[0]?.waiting;
          })
          .toBeTruthy();
      } finally {
        release.resolve(true);
        await blocker;
        await Promise.all([capture, reset]);
      }
      await expect(capture).resolves.toMatchObject({ status: "recorded" });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.userId, userId))
      ).resolves.toHaveLength(0);
    });

    test("checks the current learning setting after acquiring the reset lock", async () => {
      const locked = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const blocker = control.begin(async (tx) => {
        await tx`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
        locked.resolve(true);
        await release.promise;
        await tx`
          INSERT INTO "aiMemoryScopeConfig"
            (id, "scopeKey", scope, "userId", "activeLearningEnabled", "createdAt", "updatedAt")
          VALUES
            (${crypto.randomUUID()}, ${`user:${userId}`}, 'user', ${userId}, false, now(), now())
        `;
      });
      await locked.promise;
      const capture = learnAiMemoryFromFeedback(observation);
      try {
        await expect
          .poll(async () => {
            const rows = await db.$client<{ waiting: boolean }[]>`
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database()
                  AND wait_event_type = 'Lock'
                  AND query LIKE 'select%from "user"%for update%'
              ) AS waiting
            `;
            return rows[0]?.waiting;
          })
          .toBeTruthy();
      } finally {
        release.resolve(true);
        await blocker;
      }
      await expect(capture).resolves.toMatchObject({ status: "skipped" });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.userId, userId))
      ).resolves.toHaveLength(0);
      await db
        .delete(aiMemoryScopeConfig)
        .where(eq(aiMemoryScopeConfig.userId, userId));
    });
  }
);
