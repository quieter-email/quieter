import { embedSearchTexts } from "@quieter/ai/search-embeddings";
import type { reportAiUsage } from "@quieter/billing";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import {
  aiMemory,
  chat,
  chatMessage,
  mailbox,
  member,
  organization,
  semanticEmbedding,
  semanticIndexRequest,
  semanticSearchLease,
  user,
} from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { loadAiAgentContext } from "../src/ai-memory-context";
import {
  indexSemanticSources,
  searchSemanticHistory,
} from "../src/semantic-search";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  organizationId: crypto.randomUUID(),
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
vi.mock(import("sst"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    Resource: new Proxy(actual.Resource, {
      get() {
        throw new Error("Linked resources are disabled for isolated tests.");
      },
    }),
  };
});
vi.mock(import("@quieter/ai/search-embeddings"), async (original) => ({
  ...(await original()),
  embedSearchTexts: vi.fn<typeof embedSearchTexts>(),
}));
vi.mock(import("@quieter/billing/ai-reservation"), async (original) => ({
  ...(await original()),
  createMailboxAiBillingContext: vi
    .fn<typeof createMailboxAiBillingContext>()
    .mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: crypto.randomUUID(),
      kind: "team",
      organizationId: state.organizationId,
      usageKind: "aiMemory",
    }),
}));
vi.mock(import("@quieter/billing"), async (original) => ({
  ...(await original()),
  reportAiUsage: vi.fn<typeof reportAiUsage>(),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "search queries during exclusive source preparation",
  () => {
    const userId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const memoryId = crypto.randomUUID();
    const pendingMemoryId = crypto.randomUUID();
    const instructionId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    const pendingChatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const pendingMessageId = crypto.randomUUID();
    const preparationToken = crypto.randomUUID();
    const now = new Date();
    const vector = Array.from({ length: 1024 }, (_, position) =>
      Number(position === 0)
    );
    let fixturesMayExist = false;

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test" ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          "Contention tests require disposable loopback PostgreSQL."
        );
      }
      fixturesMayExist = true;
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Synthetic query user",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: state.organizationId,
        name: "Synthetic contention workspace",
        slug: state.organizationId,
      });
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId: state.organizationId,
        role: "member",
        userId,
      });
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        organizationId: state.organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
    });

    beforeEach(async () => {
      await db.delete(aiMemory).where(eq(aiMemory.userId, userId));
      await db.delete(chat).where(eq(chat.userId, userId));
      await db
        .delete(semanticSearchLease)
        .where(eq(semanticSearchLease.userId, userId));
      await db
        .delete(semanticIndexRequest)
        .where(eq(semanticIndexRequest.userId, userId));
      vi.mocked(embedSearchTexts).mockReset();
      vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) =>
        Promise.resolve(values.map(() => vector))
      );
      const memory = {
        confidence: 1,
        createdAt: now,
        importance: 3,
        kind: "learned" as const,
        lastConfirmedAt: now,
        metadata: { agents: ["all"], category: "preferences" as const },
        scope: "user" as const,
        scopeKey: `user:${userId}`,
        source: "explicit" as const,
        updatedAt: now,
        userId,
      };
      await db.insert(aiMemory).values([
        {
          ...memory,
          content: "Avoid red-eye flights.",
          id: memoryId,
          key: memoryId,
          summary: "Flight preference",
        },
        {
          ...memory,
          content: "Use short paragraphs.",
          id: instructionId,
          key: instructionId,
          kind: "instruction",
          summary: "Writing instruction",
        },
      ]);
      await db.insert(chat).values(
        [chatId, pendingChatId].map((id) => ({
          createdAt: now,
          id,
          mailboxId,
          title: "Synthetic planning conversation",
          updatedAt: now,
          userId,
        }))
      );
      await db.insert(chatMessage).values({
        chatId,
        createdAt: now,
        id: messageId,
        parts: [
          { text: "The unveiling is planned for late autumn.", type: "text" },
        ],
        position: 0,
        role: "user",
        userId,
      });
      await indexSemanticSources({ kind: "memory", mailboxId, userId });
      await indexSemanticSources({ kind: "chat", mailboxId, userId });
      await db.insert(aiMemory).values({
        ...memory,
        content: "Prefers budget hotels.",
        id: pendingMemoryId,
        key: pendingMemoryId,
        summary: "Hotel preference",
      });
      await db.insert(chatMessage).values({
        chatId: pendingChatId,
        createdAt: now,
        id: pendingMessageId,
        parts: [{ text: "Lexicalneedle supplier discussion.", type: "text" }],
        position: 0,
        role: "user",
        userId,
      });
      await db.insert(semanticSearchLease).values({
        expiresAt: new Date(Date.now() + 60_000),
        mailboxId,
        token: preparationToken,
        userId,
      });
      vi.mocked(embedSearchTexts).mockClear();
    });

    afterAll(async () => {
      if (!fixturesMayExist) {
        return;
      }
      await db.delete(aiMemory).where(eq(aiMemory.userId, userId));
      await db
        .delete(organization)
        .where(eq(organization.id, state.organizationId));
      await db.delete(user).where(eq(user.id, userId));
    });

    test("AI context remains available without duplicating the indexer's pending work", async () => {
      const query = "overnight air travel";
      const context = await loadAiAgentContext({
        agent: "compose",
        mailboxId,
        query,
        semantic: { billingMailboxId: mailboxId },
        userId,
      });
      expect(context.instructions).toContain("short paragraphs");
      expect(context.memory).toContain("red-eye flights");
      expect(
        vi
          .mocked(embedSearchTexts)
          .mock.calls.flatMap(([input]) => input.values)
      ).toStrictEqual([query]);
      await expect(
        db
          .select({ id: semanticEmbedding.memoryId })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.memoryId, pendingMemoryId))
      ).resolves.toHaveLength(0);
      const [lease] = await db
        .select({ token: semanticSearchLease.token })
        .from(semanticSearchLease)
        .where(eq(semanticSearchLease.userId, userId));
      expect(lease?.token).toBe(preparationToken);
    });

    test("history still combines existing vectors and pending lexical sources", async () => {
      const query = "Lexicalneedle";
      const result = await searchSemanticHistory({
        kind: "chat",
        mailboxId,
        query,
        userId,
      });
      expect(result.items.map((item) => item.messageId)).toContain(messageId);
      expect(result.items.map((item) => item.messageId)).toContain(
        pendingMessageId
      );
      expect(result.coverage).toMatchObject({
        indexedSources: 1,
        totalSources: 2,
      });
      expect(
        vi
          .mocked(embedSearchTexts)
          .mock.calls.flatMap(([input]) => input.values)
      ).toStrictEqual([query]);
      await expect(
        db
          .select({ id: semanticEmbedding.chatMessageId })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.chatMessageId, pendingMessageId))
      ).resolves.toHaveLength(0);
    });

    test("index-only contention stays retryable and makes no provider request", async () => {
      await expect(
        indexSemanticSources({ kind: "memory", mailboxId, userId })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(embedSearchTexts).not.toHaveBeenCalled();
    });

    test("query provider failures still abort the AI request and preserve the active lease", async () => {
      const failure = new Error("Synthetic query provider failure.");
      vi.mocked(embedSearchTexts).mockRejectedValueOnce(failure);
      await expect(
        loadAiAgentContext({
          agent: "compose",
          mailboxId,
          query: "overnight air travel",
          semantic: { billingMailboxId: mailboxId },
          userId,
        })
      ).rejects.toBe(failure);
      const [lease] = await db
        .select({ token: semanticSearchLease.token })
        .from(semanticSearchLease)
        .where(eq(semanticSearchLease.userId, userId));
      expect(lease?.token).toBe(preparationToken);
    });
  }
);
