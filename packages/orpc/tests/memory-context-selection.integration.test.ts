import { db } from "@quieter/database/client";
import {
  aiMemory,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  loadAiAgentContext,
  serializeAiAgentContext,
} from "../src/ai-memory-context";

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
vi.mock(import("../src/mailbox/service"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    assertAccessibleMailbox: vi
      .fn<typeof actual.assertAccessibleMailbox>()
      .mockResolvedValue({
        capabilities: getMailboxCapabilities({ provider: "gmail" }),
        contentRevision: 0,
        id: "authorized-mailbox",
        organizationId: "test",
        provider: "gmail",
      }),
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "full-scope memory recall on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const foreignMailboxId = crypto.randomUUID();
    const now = new Date();
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Memory integration requires loopback quieter_migration_test."
        );
      }
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Test reader",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Memory test",
        slug: organizationId,
      });
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: "reader@example.test",
        id: mailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: "other@example.test",
        id: foreignMailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
      const base = {
        confidence: 1,
        createdAt: now,
        importance: 5,
        kind: "learned" as const,
        lastConfirmedAt: now,
        scope: "user" as const,
        scopeKey: `user:${userId}`,
        source: "explicit" as const,
        updatedAt: now,
        userId,
      };
      await db.insert(aiMemory).values([
        ...Array.from({ length: 260 }, (_, index) => ({
          ...base,
          content: `Project ${index} progress and milestones.`,
          id: crypto.randomUUID(),
          key: `project-${index}`,
          metadata: { agents: ["all"], category: "work" as const },
          summary: `Project ${index}`,
        })),
        {
          ...base,
          content: "Writes short paragraphs and uses Cheers as a sign-off.",
          id: crypto.randomUUID(),
          importance: 2,
          key: "general-voice",
          metadata: { agents: ["all"], category: "writing_style" },
          summary: "General voice",
        },
        {
          ...base,
          content: "Uses German and the informal du with Alex.",
          id: crypto.randomUUID(),
          importance: 1,
          key: "alex-voice",
          metadata: {
            agents: ["all"],
            category: "writing_style",
            correspondents: ["alex@example.test"],
          },
          summary: "Alex tone",
        },
        {
          ...base,
          content: "Alex is my husband.",
          id: crypto.randomUUID(),
          key: "husband",
          metadata: {
            agents: ["all"],
            category: "relationships",
            correspondents: ["alex@example.test"],
          },
          summary: "Relationship to Alex",
        },
        {
          ...base,
          content: "Foreign mailbox private detail",
          id: crypto.randomUUID(),
          key: "foreign",
          mailboxId: foreignMailboxId,
          metadata: { agents: ["all"], category: "writing_style" },
          scope: "mailbox",
          scopeKey: `mailbox:${foreignMailboxId}`,
          summary: "Foreign knowledge",
          userId: null,
        },
      ]);
    });

    afterAll(async () => {
      await db
        .delete(aiMemory)
        .where(eq(aiMemory.scopeKey, `mailbox:${foreignMailboxId}`));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
    });

    test("finds older contact and core voice beyond the previous candidate cutoff", async () => {
      const context = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "reply_suggestion",
          mailboxId,
          query: "Alex <alex@example.test> asks about the next project",
          userId,
        })
      );
      expect(context).toContain("informal du");
      expect(context).toContain("Cheers");
      expect(context).not.toContain("Foreign mailbox private detail");
    });

    test("loads relationship facts when the query names a role instead of an email", async () => {
      const context = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "search",
          mailboxId,
          query: "emails from my husband",
          userId,
        })
      );
      expect(context).toContain("Alex is my husband");
      expect(context).toContain("alex@example.test");
    });

    test("searches and pages the complete text collection with no candidate truncation", async () => {
      const page = await loadAiAgentContext({
        mailboxId,
        overview: { query: "Project 259" },
        userId,
      });
      expect(page.items).toContainEqual(
        expect.objectContaining({
          content: "Project 259 progress and milestones.",
        })
      );
      expect(page.hasMore).toBeFalsy();
    });
  }
);
