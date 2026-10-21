import { db } from "@quieter/database/client";
import {
  aiMemory,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { loadAiAgentContext } from "../src/ai-memory";
import type {
  AiMemoryOverviewCursor,
  AiMemoryOverviewPage,
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
  "personal context overviews on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const otherMailboxId = crypto.randomUUID();
    const now = new Date();
    const records = Array.from({ length: 231 }, (_, index) => {
      const id = `overview-${userId}-record-${index.toString().padStart(3, "0")}`;
      const personal = index % 2 === 0;
      return {
        content: `Context ${index}: ${"personal detail ".repeat(60)}`,
        createdAt: now,
        id,
        key: id,
        kind: index % 3 === 0 ? ("instruction" as const) : ("learned" as const),
        lastConfirmedAt: now,
        mailboxId: personal ? null : mailboxId,
        metadata: { agents: ["auto_label"], topics: ["unrelated topic"] },
        scope: personal ? ("user" as const) : ("mailbox" as const),
        scopeKey: personal ? `user:${userId}` : `mailbox:${mailboxId}`,
        source: "explicit" as const,
        summary: `Context ${index}`,
        updatedAt: now,
        userId: personal ? userId : null,
      };
    });

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Memory overview integration tests require loopback quieter_migration_test."
        );
      }
      await db.insert(user).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Memory overview test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Memory overview test",
        slug: organizationId,
      });
      await db.insert(mailbox).values(
        [mailboxId, otherMailboxId].map((id) => ({
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${id}@example.test`,
          id,
          organizationId,
          ownerUserId: id === mailboxId ? userId : otherUserId,
          provider: "gmail" as const,
          updatedAt: now,
        }))
      );
      await db.insert(aiMemory).values(records);
      const [base] = records;
      await db.insert(aiMemory).values([
        {
          ...base,
          content: "Foreign personal context",
          id: crypto.randomUUID(),
          key: "foreign-user",
          scopeKey: `user:${otherUserId}`,
          userId: otherUserId,
        },
        {
          ...base,
          content: "Foreign mailbox context",
          id: crypto.randomUUID(),
          key: "foreign-mailbox",
          mailboxId: otherMailboxId,
          scope: "mailbox",
          scopeKey: `mailbox:${otherMailboxId}`,
          userId: null,
        },
        {
          ...base,
          content: "Archived context",
          id: crypto.randomUUID(),
          key: "archived",
          status: "archived",
        },
        {
          ...base,
          content: "Expired context",
          expiresAt: new Date(now.getTime() - 1000),
          id: crypto.randomUUID(),
          key: "expired",
        },
      ]);
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
      await db.$client.end();
    });

    test("reads full authorized active context across stable pages without ranking or writes", async () => {
      const reviewed: AiMemoryOverviewPage["items"] = [];
      let cursor: AiMemoryOverviewCursor | undefined;
      let pages = 0;
      do {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each cursor comes from the previous page.
        const page = await loadAiAgentContext({
          mailboxId,
          overview: { cursor },
          userId,
        });
        reviewed.push(...page.items);
        pages += 1;
        expect(page.total).toBe(records.length);
        expect(page.hasMore).toBe(page.nextCursor !== null);
        cursor = page.nextCursor ?? undefined;
        if (pages === 1) {
          const [base] = records;
          // oxlint-disable-next-line eslint/no-await-in-loop -- Simulates a concurrent insertion between pages.
          await db.insert(aiMemory).values({
            ...base,
            createdAt: new Date(Date.now() + 1000),
            id: crypto.randomUUID(),
            key: "inserted-between-pages",
          });
        }
      } while (cursor && pages < 10);

      expect(pages).toBeGreaterThan(1);
      expect(cursor).toBeUndefined();
      expect(reviewed).toHaveLength(records.length);
      expect(reviewed.map((item) => item.id).toSorted()).toStrictEqual(
        records.map((item) => item.id).toSorted()
      );
      expect(
        reviewed.map((item) => item.content).join("\n").length
      ).toBeGreaterThan(4000);
      for (const record of records) {
        expect(reviewed.find((item) => item.id === record.id)).toMatchObject({
          content: record.content,
          kind: record.kind,
          scope: record.scope,
        });
      }
      const stored = await db
        .select()
        .from(aiMemory)
        .where(
          inArray(
            aiMemory.id,
            records.map((item) => item.id)
          )
        );
      expect(
        stored.every(
          (item) =>
            item.lastUsedAt === null &&
            item.version === 1 &&
            item.updatedAt.getTime() === now.getTime()
        )
      ).toBeTruthy();
    });

    test("rejects inaccessible mailbox requests instead of returning personal context", async () => {
      await expect(
        loadAiAgentContext({ mailboxId: otherMailboxId, overview: {}, userId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("redacts legacy secret content before returning any page while keeping totals honest", async () => {
      const [base] = records;
      const id = `overview-${userId}-000-sensitive-detail`;
      await db.insert(aiMemory).values({
        ...base,
        content: "Verification code 123456",
        createdAt: new Date(0),
        id,
        key: id,
        summary: "Verification code 123456",
      });
      const page = await loadAiAgentContext({
        mailboxId,
        overview: {},
        userId,
      });
      const redacted = page.items.find((item) => item.id === id);
      expect(redacted).toBeDefined();
      expect(JSON.stringify(page)).not.toContain("123456");
      expect(redacted?.content).toMatch(/sensitive detail/iu);
      expect(page.total).toBeGreaterThan(records.length);
      await db.delete(aiMemory).where(eq(aiMemory.id, id));
    });
  }
);
