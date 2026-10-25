import { db } from "@quieter/database/client";
import {
  aiMemory,
  mailbox,
  mailboxGrant,
  member,
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

import {
  loadAiAgentContext,
  loadAiAgentMemoryCandidates,
  rankAiAgentMemoryCandidates,
  searchAiMemory,
  serializeAiAgentContext,
} from "../src/ai-memory";
import type { AiMemoryContextSelection } from "../src/ai-memory";

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
  "user-owned memory recall on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const secondMailboxId = crypto.randomUUID();
    const sharedMailboxId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const foreignMailboxId = crypto.randomUUID();
    const now = new Date();
    const interestId = crypto.randomUUID();
    const longInterestRecords = Array.from({ length: 40 }, (_, index) => ({
      content: `Craftnotes ${index}: ${"Enjoys learning pottery techniques and sharing the results with friends. ".repeat(20)}`,
      id: crypto.randomUUID(),
      importance: 3,
      key: `craft-${index}`,
      metadata: { agents: ["all"], category: "interests" as const },
      summary: `Craftnotes ${index}`,
    }));
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
      await db.insert(user).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Test reader",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Memory test",
        slug: organizationId,
      });
      await db.insert(member).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          organizationId,
          role: "member",
          userId: id,
        }))
      );
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: `${secondMailboxId}@example.test`,
        id: secondMailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
      await db.insert(mailbox).values({
        accessMode: "shared",
        createdAt: now,
        emailAddress: `${sharedMailboxId}@example.test`,
        id: sharedMailboxId,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      await db.insert(mailboxGrant).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          mailboxId: sharedMailboxId,
          role: "reader" as const,
          updatedAt: now,
          userId: id,
        }))
      );
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
        ownerUserId: otherUserId,
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
        ...longInterestRecords.map((record) => ({ ...base, ...record })),
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
          content: "Enjoys ceramics and weekend pottery.",
          id: interestId,
          key: "ceramics",
          metadata: { agents: ["all"], category: "interests" },
          summary: "Ceramics",
        },
        {
          ...base,
          content: "Prefers focused work blocks in the morning.",
          id: crypto.randomUUID(),
          key: "work-blocks",
          metadata: { agents: ["all"], category: "preferences" },
          summary: "Personal preference",
        },
        {
          ...base,
          content: "Do not assume remembered availability is current.",
          id: crypto.randomUUID(),
          key: "availability-instruction",
          kind: "instruction",
          metadata: { agents: ["all"], category: "preferences" },
          summary: "Availability instruction",
        },
        {
          ...base,
          content: "Selected mailbox private detail",
          id: crypto.randomUUID(),
          key: "selected-mailbox",
          mailboxId,
          metadata: { agents: ["all"], category: "preferences" },
          scope: "mailbox",
          scopeKey: `mailbox:${mailboxId}`,
          summary: "Selected mailbox knowledge",
          userId: null,
        },
        {
          ...base,
          content: "Apply Receipts to paid invoices in the first inbox.",
          id: crypto.randomUUID(),
          key: "first-inbox-receipts",
          metadata: {
            agents: ["all"],
            category: "labeling",
            sourceMailboxId: mailboxId,
          },
          source: "feedback",
          summary: "First inbox receipt preference",
        },
        {
          ...base,
          content: "Apply Purchases to paid invoices in the second inbox.",
          id: crypto.randomUUID(),
          key: "second-inbox-purchases",
          metadata: {
            agents: ["all"],
            category: "labeling",
            sourceMailboxId: secondMailboxId,
          },
          source: "feedback",
          summary: "Second inbox purchase preference",
        },
        {
          ...base,
          content: "Shared mailbox legacy detail",
          id: crypto.randomUUID(),
          key: "shared-mailbox-legacy",
          mailboxId: sharedMailboxId,
          metadata: { agents: ["all"], category: "preferences" },
          scope: "mailbox",
          scopeKey: `mailbox:${sharedMailboxId}`,
          summary: "Legacy shared knowledge",
          userId: null,
        },
        {
          ...base,
          content: "Foreign user private detail",
          id: crypto.randomUUID(),
          key: "foreign-user",
          metadata: { agents: ["all"], category: "preferences" },
          scopeKey: `user:${otherUserId}`,
          summary: "Foreign personal knowledge",
          userId: otherUserId,
        },
        {
          ...base,
          content: "Foreign mailbox private detail",
          id: crypto.randomUUID(),
          key: "foreign",
          mailboxId: foreignMailboxId,
          metadata: { agents: ["all"], category: "preferences" },
          scope: "mailbox",
          scopeKey: `mailbox:${foreignMailboxId}`,
          summary: "Foreign knowledge",
          userId: null,
        },
        ...(
          [
            "interests",
            "interests",
            "preferences",
          ] satisfies AiMemoryContextSelection["categories"]
        ).map((category, index) => ({
          ...base,
          content: `Facetneedle matching detail ${index}`,
          id: crypto.randomUUID(),
          key: `facet-${index}`,
          metadata: {
            agents: ["all"],
            category,
          },
          summary: "Matching detail",
        })),
        {
          ...base,
          content: "Facetneedle preference without a stored category",
          id: crypto.randomUUID(),
          key: "facet-default-category",
          metadata: { agents: ["all"] },
          summary: "Legacy preference",
        },
        {
          ...base,
          content: "Work detail matched through the summary",
          id: crypto.randomUUID(),
          key: "facet-summary",
          metadata: { agents: ["all"], category: "work" },
          summary: "Facetneedle work",
        },
        ...["archived", "expired", "foreign-user", "mailbox"].map((kind) => {
          const personalUserId = kind === "foreign-user" ? otherUserId : userId;
          return {
            ...base,
            content: `Facetneedle ${kind} detail`,
            expiresAt:
              kind === "expired" ? new Date(now.getTime() - 1000) : null,
            id: crypto.randomUUID(),
            key: `facet-${kind}`,
            mailboxId: kind === "mailbox" ? mailboxId : null,
            metadata: { agents: ["all"], category: "interests" as const },
            scope:
              kind === "mailbox" ? ("mailbox" as const) : ("user" as const),
            scopeKey:
              kind === "mailbox"
                ? `mailbox:${mailboxId}`
                : `user:${personalUserId}`,
            status:
              kind === "archived" ? ("archived" as const) : ("active" as const),
            summary: "Excluded from personal active matches",
            userId: kind === "mailbox" ? null : personalUserId,
          };
        }),
      ]);
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
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

    test("reads only the acting user's personal context without a mailbox", async () => {
      const context = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "future_planner",
          query: "",
          selection: { categories: ["preferences"], characterBudget: 4000 },
          userId,
        })
      );
      expect(context).toContain("focused work blocks");
      expect(context).not.toMatch(
        /Selected mailbox private detail|Foreign mailbox private detail|Foreign user private detail/u
      );
      const overview = await loadAiAgentContext({
        overview: { query: "private detail" },
        userId,
      });
      expect(JSON.stringify(overview.items)).not.toMatch(/private detail/u);
    });

    test("keeps the user's general knowledge available across their mailboxes", async () => {
      const firstInbox = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "future_planner",
          mailboxId,
          query: "",
          selection: { categories: ["preferences"], characterBudget: 4000 },
          userId,
        })
      );
      expect(firstInbox).toContain("focused work blocks");
      expect(firstInbox).not.toMatch(
        /Selected mailbox private detail|Foreign mailbox private detail|Foreign user private detail/u
      );
      const secondInbox = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "future_planner",
          mailboxId: secondMailboxId,
          query: "",
          selection: { categories: ["preferences"], characterBudget: 4000 },
          userId,
        })
      );
      expect(secondInbox).toContain("focused work blocks");
      expect(secondInbox).not.toMatch(
        /Selected mailbox private detail|Foreign mailbox private detail|Foreign user private detail/u
      );
    });

    test("uses only the acting reader's knowledge in a shared mailbox", async () => {
      const firstReader = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "future_planner",
          mailboxId: sharedMailboxId,
          query: "",
          selection: { categories: ["preferences"], characterBudget: 4000 },
          userId,
        })
      );
      expect(firstReader).toContain("focused work blocks");
      expect(firstReader).not.toMatch(
        /Shared mailbox legacy detail|Foreign user private detail/u
      );
      const secondReader = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "future_planner",
          mailboxId: sharedMailboxId,
          query: "",
          selection: { categories: ["preferences"], characterBudget: 4000 },
          userId: otherUserId,
        })
      );
      expect(secondReader).toContain("Foreign user private detail");
      expect(secondReader).not.toMatch(
        /focused work blocks|Shared mailbox legacy detail/u
      );
      const overview = await loadAiAgentContext({
        mailboxId: sharedMailboxId,
        overview: { query: "private detail" },
        userId: otherUserId,
      });
      expect(overview.items).toHaveLength(1);
      expect(overview.items[0]?.content).toContain(
        "Foreign user private detail"
      );
    });

    test("keeps label preferences applicable only to their originating mailbox", async () => {
      const firstInbox = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "auto_label",
          mailboxId,
          query: "paid invoices",
          userId,
        })
      );
      expect(firstInbox).toContain("Apply Receipts");
      expect(firstInbox).not.toContain("Apply Purchases");
      const secondInbox = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "auto_label",
          mailboxId: secondMailboxId,
          query: "paid invoices",
          userId,
        })
      );
      expect(secondInbox).toContain("Apply Purchases");
      expect(secondInbox).not.toContain("Apply Receipts");
      const withoutMailbox = serializeAiAgentContext(
        await loadAiAgentContext({
          agent: "auto_label",
          query: "paid invoices",
          userId,
        })
      );
      expect(withoutMailbox).not.toMatch(/Apply Receipts|Apply Purchases/u);
      const overview = await loadAiAgentContext({
        mailboxId,
        overview: { query: "paid invoices" },
        userId,
      });
      expect(overview.items.map((item) => item.content).join(" ")).toMatch(
        /Apply Receipts.*Apply Purchases|Apply Purchases.*Apply Receipts/u
      );
      const settings = await searchAiMemory({ query: "paid invoices", userId });
      expect(settings.total).toBe(2);
    });

    test("rejects a candidate handle borrowed from another reader", async () => {
      const candidates = await loadAiAgentMemoryCandidates({
        mailboxId: sharedMailboxId,
        userId,
      });
      await expect(
        loadAiAgentContext({
          agent: "compose",
          candidates,
          mailboxId: sharedMailboxId,
          query: "",
          userId: otherUserId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        rankAiAgentMemoryCandidates({
          agent: "compose",
          candidates,
          query: "",
          userId: otherUserId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("rechecks access after a cached candidate handle loses mailbox ownership", async () => {
      const candidates = await loadAiAgentMemoryCandidates({
        mailboxId,
        userId,
      });
      await db
        .update(mailbox)
        .set({ ownerUserId: otherUserId })
        .where(eq(mailbox.id, mailboxId));
      try {
        await expect(
          loadAiAgentContext({
            agent: "compose",
            candidates,
            mailboxId,
            query: "",
            userId,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          rankAiAgentMemoryCandidates({
            agent: "compose",
            candidates,
            query: "",
            userId,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await db
          .update(mailbox)
          .set({ ownerUserId: userId })
          .where(eq(mailbox.id, mailboxId));
      }
    });

    test("uses custom categories and budget throughout recall while retaining instructions", async () => {
      const selection = {
        categories: ["interests"],
        characterBudget: 1200,
      } satisfies AiMemoryContextSelection;
      const defaultContext = await loadAiAgentContext({
        agent: "compose",
        query: "",
        userId,
      });
      expect(defaultContext.memory).not.toMatch(/Craftnotes|weekend pottery/u);
      const context = await loadAiAgentContext({
        agent: "compose",
        query: "",
        selection,
        userId,
      });
      expect(context.instructions).toContain("remembered availability");
      expect(context.memory).toMatch(/Facetneedle|weekend pottery/u);
      expect(context.memory).not.toMatch(/Cheers|Project \d/u);
      expect(
        (context.instructions?.length ?? 0) + (context.memory?.length ?? 0)
      ).toBeLessThanOrEqual(selection.characterBudget);
      const [stored] = await db
        .select({ lastUsedAt: aiMemory.lastUsedAt, version: aiMemory.version })
        .from(aiMemory)
        .where(eq(aiMemory.id, interestId));
      expect(stored).toMatchObject({ lastUsedAt: null, version: 1 });
    });

    test("rejects invalid selections and bounds a finite oversized context request", async () => {
      await expect(
        loadAiAgentContext({
          agent: "future_planner",
          query: "",
          selection: { categories: [], characterBudget: 1000 },
          userId,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        loadAiAgentContext({
          agent: "future_planner",
          query: "",
          selection: {
            categories: ["interests"],
            characterBudget: Number.POSITIVE_INFINITY,
          },
          userId,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const context = await loadAiAgentContext({
        agent: "future_planner",
        query: "Craftnotes",
        selection: {
          categories: ["interests"],
          characterBudget: Number.MAX_VALUE,
        },
        userId,
      });
      expect(context.memory).toMatch(/Craftnotes|pottery/u);
      expect(
        (context.instructions?.length ?? 0) + (context.memory?.length ?? 0)
      ).toBeLessThan(
        longInterestRecords.reduce(
          (length, record) => length + record.content.length,
          0
        )
      );
    });

    test("counts every matching category before filtering or paging in the authorized scope", async () => {
      const first = await searchAiMemory({
        category: "interests",
        limit: 1,
        query: "Facetneedle",
        userId,
      });
      expect(first.items).toHaveLength(1);
      expect(first.total).toBe(2);
      expect(first.categoryCounts).toContainEqual({
        category: "interests",
        count: 2,
      });
      expect(first.categoryCounts).toContainEqual({
        category: "preferences",
        count: 2,
      });
      expect(first.categoryCounts).toContainEqual({
        category: "work",
        count: 1,
      });
      expect(first.categoryCounts).toContainEqual({
        category: "relationships",
        count: 0,
      });
      expect(first.nextCursor).not.toBeNull();
      const second = await searchAiMemory({
        category: "interests",
        cursor: first.nextCursor,
        limit: 1,
        query: "Facetneedle",
        userId,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
      expect(second.total).toBe(first.total);
      expect(second.categoryCounts).toStrictEqual(first.categoryCounts);
      const all = await searchAiMemory({
        query: "Facetneedle",
        userId,
      });
      expect(all.total).toBe(
        first.categoryCounts.reduce((total, row) => total + row.count, 0)
      );
    });
  }
);
