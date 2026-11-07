import { setImmediate } from "node:timers/promises";

import { ORPCError } from "@orpc/server";
import { embedSearchTexts } from "@quieter/ai/search-embeddings";
import type { reportAiUsage } from "@quieter/billing";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import {
  aiMemory,
  chat,
  chatMessage,
  gmailCapturedMessage,
  mailbox,
  mailboxGrant,
  managedMailMessage,
  member,
  organization,
  semanticEmbedding,
  user,
} from "@quieter/database/schema";
import { analyzeMailMessage } from "@quieter/mail/capture";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  indexSemanticSources,
  prepareSemanticSearch,
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
        throw new Error(
          "Linked resources are disabled for isolated search tests."
        );
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

const semanticVector = Array.from({ length: 1024 }, (_, position) =>
  Number(position === 0)
);
const unrelatedVector = Array.from({ length: 1024 }, (_, position) =>
  Number(position === 1)
);

const snapshot = (
  messageId: string,
  content: string
): CapturedMailSnapshot => ({
  attachments: [],
  bodyHtml: null,
  bodyText: content,
  headers: [{ name: "Subject", value: "Synthetic delivery discussion" }],
  id: messageId,
  internalDate: String(Date.now()),
  labelIds: ["INBOX"],
  providerRevision: "1",
  threadId: `thread-${messageId}`,
  truncation: {
    attachments: false,
    bodyHtml: false,
    bodyText: false,
    headers: false,
  },
});

describe.skipIf(state.databaseUrl === undefined)(
  "source-bound semantic search",
  () => {
    const actor = crypto.randomUUID();
    const colleague = crypto.randomUUID();
    const mailboxIds = {
      foreign: crypto.randomUUID(),
      primary: crypto.randomUUID(),
      secondary: crypto.randomUUID(),
      shared: crypto.randomUUID(),
    };
    const now = new Date();
    let fixturesMayExist = false;

    const saveMemory = async (
      values: Pick<typeof aiMemory.$inferInsert, "content"> &
        Partial<
          Pick<
            typeof aiMemory.$inferInsert,
            "expiresAt" | "metadata" | "status" | "userId"
          >
        >
    ) => {
      const id = crypto.randomUUID();
      await db.insert(aiMemory).values({
        confidence: 1,
        content: values.content,
        createdAt: now,
        expiresAt: values.expiresAt,
        id,
        importance: 3,
        key: id,
        kind: "learned",
        lastConfirmedAt: now,
        metadata: {
          agents: ["all"],
          category: "preferences",
          ...values.metadata,
        },
        scope: "user",
        scopeKey: `user:${values.userId ?? actor}`,
        source: "explicit",
        status: values.status ?? "active",
        summary: values.content.slice(0, 200),
        updatedAt: now,
        userId: values.userId ?? actor,
      });
      return id;
    };
    const saveChat = async (input: {
      content: string;
      parts?: typeof chatMessage.$inferInsert.parts;
      role?: typeof chatMessage.$inferInsert.role;
      userId?: string;
    }) => {
      const chatId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const userId = input.userId ?? actor;
      await db.insert(chat).values({
        createdAt: now,
        id: chatId,
        mailboxId: mailboxIds.shared,
        title: "Synthetic planning conversation",
        updatedAt: now,
        userId,
      });
      await db.insert(chatMessage).values({
        chatId,
        createdAt: now,
        id: messageId,
        parts: input.parts ?? [{ text: input.content, type: "text" }],
        position: 0,
        role: input.role ?? "user",
        userId,
      });
      return { chatId, messageId };
    };
    const saveGmail = async (input: {
      content: string;
      mailboxId?: string;
      messageId?: string;
    }) => {
      const message = snapshot(
        input.messageId ?? crypto.randomUUID(),
        input.content
      );
      await db.insert(gmailCapturedMessage).values({
        analysis: analyzeMailMessage(message),
        capturedAt: now,
        mailboxId: input.mailboxId ?? mailboxIds.primary,
        messageId: message.id,
        providerRevision: message.providerRevision,
        snapshot: message,
        source: "on_demand",
        updatedAt: now,
      });
      return message.id;
    };
    const saveManaged = async (input: {
      content: string;
      state?: typeof managedMailMessage.$inferInsert.mailboxState;
    }) => {
      const id = crypto.randomUUID();
      await db.insert(managedMailMessage).values({
        bodyText: input.content,
        createdAt: now,
        direction: "inbound",
        from: "sender@example.test",
        id,
        mailboxId: mailboxIds.shared,
        mailboxState: input.state ?? "active",
        providerMessageId: id,
        sentAt: now,
        subject: "Synthetic supplier discussion",
        threadId: `thread-${id}`,
        updatedAt: now,
      });
      return id;
    };

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
          "Search tests require disposable loopback quieter_migration_test."
        );
      }
      await db.execute(sql`select 1 from ${semanticEmbedding} limit 1`);
      fixturesMayExist = true;
      await db.insert(user).values(
        [actor, colleague].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Synthetic search user",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: state.organizationId,
        name: "Synthetic search workspace",
        slug: state.organizationId,
      });
      await db.insert(member).values(
        [actor, colleague].map((id) => ({
          createdAt: now,
          id: `member-${id}`,
          organizationId: state.organizationId,
          role: "member",
          userId: id,
        }))
      );
      const owners: Record<string, string | null> = {
        foreign: colleague,
        primary: actor,
        secondary: actor,
        shared: null,
      };
      await db.insert(mailbox).values(
        Object.entries(mailboxIds).map(([kind, id]) => ({
          accessMode:
            kind === "shared" ? ("shared" as const) : ("private" as const),
          createdAt: now,
          emailAddress: `${id}@example.test`,
          id,
          organizationId: state.organizationId,
          ownerUserId: owners[kind],
          provider:
            kind === "shared" ? ("managed" as const) : ("gmail" as const),
          updatedAt: now,
        }))
      );
    });
    beforeEach(async () => {
      if (!fixturesMayExist) {
        return;
      }
      await db
        .delete(aiMemory)
        .where(inArray(aiMemory.userId, [actor, colleague]));
      await db.delete(chat).where(inArray(chat.userId, [actor, colleague]));
      await db
        .delete(gmailCapturedMessage)
        .where(
          inArray(gmailCapturedMessage.mailboxId, Object.values(mailboxIds))
        );
      await db
        .delete(managedMailMessage)
        .where(eq(managedMailMessage.mailboxId, mailboxIds.shared));
      await db
        .insert(mailboxGrant)
        .values(
          [actor, colleague].map((id) => ({
            createdAt: now,
            id: crypto.randomUUID(),
            mailboxId: mailboxIds.shared,
            memberId: `member-${id}`,
            role: "reader" as const,
            updatedAt: now,
            userId: id,
          }))
        )
        .onConflictDoNothing();
      vi.mocked(embedSearchTexts).mockReset();
      vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) => {
        await setImmediate();
        return values.map(() => semanticVector);
      });
    });

    afterAll(async () => {
      if (!fixturesMayExist) {
        return;
      }
      await db
        .delete(aiMemory)
        .where(inArray(aiMemory.userId, [actor, colleague]));
      await db
        .delete(organization)
        .where(eq(organization.id, state.organizationId));
      await db.delete(user).where(inArray(user.id, [actor, colleague]));
    });

    test("word-disjoint memory matching retains owner, mailbox, status and expiry restrictions", async () => {
      const relevant = await saveMemory({ content: "Avoid red-eye flights." });
      await saveMemory({
        content: "Another user's travel preference.",
        userId: colleague,
      });
      await saveMemory({
        content: "Archived travel preference.",
        status: "archived",
      });
      await saveMemory({
        content: "Expired travel preference.",
        expiresAt: new Date(now.getTime() - 1000),
      });
      await saveMemory({
        content: "Other mailbox label rule.",
        metadata: { sourceMailboxId: mailboxIds.secondary },
      });
      const result = await prepareSemanticSearch({
        kind: "memory",
        mailboxId: mailboxIds.primary,
        query: "An overnight journey by air",
        userId: actor,
      });
      expect(result.memoryMatches.map((match) => match.id)).toStrictEqual([
        relevant,
      ]);
      expect(result.coverage).toMatchObject({
        complete: true,
        indexedSources: 1,
      });
      await expect(
        prepareSemanticSearch({
          kind: "memory",
          mailboxId: mailboxIds.foreign,
          query: "Travel",
          userId: actor,
        })
      ).rejects.toBeInstanceOf(ORPCError);
    });

    test("shared mailbox chat search keeps each user's prose private and excludes hidden payloads", async () => {
      const own = await saveChat({
        content: "We planned a launch with a quiet reception.",
        parts: [
          { text: "We planned a launch with a quiet reception.", type: "text" },
          { output: { text: "hidden-connector-token" }, type: "tool-private" },
        ],
      });
      await saveChat({
        content: "A colleague's confidential launch details.",
        userId: colleague,
      });
      await saveChat({
        content: "Hidden system instructions.",
        role: "system",
      });
      const result = await searchSemanticHistory({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        query: "Our earlier release celebration",
        userId: actor,
      });
      expect(result.items).toMatchObject([
        { chatId: own.chatId, kind: "chat", messageId: own.messageId },
      ]);
      const indexed = await db
        .select({ text: semanticEmbedding.searchText })
        .from(semanticEmbedding)
        .where(eq(semanticEmbedding.chatMessageId, own.messageId));
      expect(indexed.map((entry) => entry.text).join(" ")).not.toMatch(
        /hidden-connector-token/u
      );
    });

    test("retained Gmail identities remain mailbox-scoped and tombstones physically erase derivatives", async () => {
      const messageId = crypto.randomUUID();
      await saveGmail({
        content: "The supplier warned about freight delays.",
        messageId,
      });
      await saveGmail({
        content: "Different mailbox financial planning.",
        mailboxId: mailboxIds.secondary,
        messageId,
      });
      const result = await searchSemanticHistory({
        kind: "mail",
        mailboxId: mailboxIds.primary,
        query: "A shipping interruption",
        userId: actor,
      });
      expect(result.items).toMatchObject([{ kind: "mail", messageId }]);
      expect(result.retainedOnly).toBeTruthy();
      await db
        .update(gmailCapturedMessage)
        .set({ analysis: null, deletedAt: new Date(), snapshot: null })
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxIds.primary),
            eq(gmailCapturedMessage.messageId, messageId)
          )
        );
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(
            and(
              eq(semanticEmbedding.gmailMailboxId, mailboxIds.primary),
              eq(semanticEmbedding.gmailMessageId, messageId)
            )
          )
      ).resolves.toHaveLength(0);
      const after = await searchSemanticHistory({
        kind: "mail",
        mailboxId: mailboxIds.primary,
        query: "A shipping interruption",
        userId: actor,
      });
      expect(after.items).toHaveLength(0);
    });

    test("managed mail search excludes draft, spam and trash while preserving live source text", async () => {
      const active = await saveManaged({
        content: "The contract includes a cancellation clause.",
      });
      for (const mailboxState of ["draft", "spam", "trash"] as const) {
        await saveManaged({
          content: "The contract includes a cancellation clause.",
          state: mailboxState,
        });
      }
      const result = await searchSemanticHistory({
        kind: "mail",
        mailboxId: mailboxIds.shared,
        query: "How can we terminate the agreement?",
        userId: actor,
      });
      expect(result.items).toMatchObject([{ kind: "mail", messageId: active }]);
      await db
        .update(managedMailMessage)
        .set({ bodyText: "The agreement has been replaced." })
        .where(eq(managedMailMessage.id, active));
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.managedMessageId, active))
      ).resolves.toHaveLength(0);
    });

    test("long prose progresses across batches and lexical matching finds a later passage", async () => {
      const own = await saveChat({
        content: `${"ordinary background ".repeat(1900)} needlezyx ending`,
      });
      vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) => {
        await setImmediate();
        return values.map((value) =>
          value === "needlezyx" ? unrelatedVector : semanticVector
        );
      });
      const first = await indexSemanticSources({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        userId: actor,
      });
      expect(first.complete).toBeFalsy();
      let last = first;
      for (let attempt = 0; attempt < 4 && !last.complete; attempt += 1) {
        last = await indexSemanticSources({
          kind: "chat",
          mailboxId: mailboxIds.shared,
          userId: actor,
        });
      }
      expect(last).toMatchObject({ complete: true, indexedSources: 1 });
      const result = await searchSemanticHistory({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        query: "needlezyx",
        userId: actor,
      });
      expect(result.items).toMatchObject([
        {
          messageId: own.messageId,
        },
      ]);
      expect(result.items[0]?.snippet).toContain("needlezyx");
    });

    test("Unicode whitespace cannot block meaningful records or create empty final chunks", async () => {
      const whitespace =
        "\t\n\v\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";
      const padding = whitespace.repeat(200);
      const content = `${padding}${"ordinary background ".repeat(110)}${padding}needlezyx distinctive later passage${padding}`;
      const own = await saveChat({ content });
      await saveChat({ content: padding });
      await saveChat({
        content: `${"A separate conversation".padEnd(2000, "x")}${whitespace}`,
      });
      vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) => {
        if (values.some((value) => value.trim().length === 0)) {
          throw new Error("The embedding provider rejects blank text.");
        }
        await setImmediate();
        return values.map((value) =>
          value === "needlezyx" ? unrelatedVector : semanticVector
        );
      });
      const coverage = await indexSemanticSources({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        userId: actor,
      });
      expect(coverage).toMatchObject({
        complete: true,
        indexedSources: 2,
        totalSources: 2,
      });
      const result = await searchSemanticHistory({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        query: "needlezyx",
        userId: actor,
      });
      expect(result.items).toMatchObject([{ messageId: own.messageId }]);
      expect(result.items[0]?.snippet).toContain("needlezyx");
      const [source] = await db
        .select({ parts: chatMessage.parts })
        .from(chatMessage)
        .where(eq(chatMessage.id, own.messageId));
      expect(source?.parts).toContainEqual({ text: content, type: "text" });
    });

    test("an edit racing inference invalidates the old representation and cannot persist stale chunks", async () => {
      const id = await saveMemory({ content: "Avoid red-eye flights." });
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(embedSearchTexts).mockImplementationOnce(async ({ values }) => {
        started.resolve(true);
        await release.promise;
        return values.map(() => semanticVector);
      });
      const pending = prepareSemanticSearch({
        kind: "memory",
        mailboxId: mailboxIds.primary,
        query: "An overnight journey",
        userId: actor,
      });
      await started.promise;
      await db
        .update(aiMemory)
        .set({
          content: "Travel preferences were corrected.",
          version: sql`${aiMemory.version} + 1`,
        })
        .where(eq(aiMemory.id, id));
      release.resolve(true);
      const result = await pending;
      expect(result.memoryMatches).toHaveLength(0);
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.memoryId, id))
      ).resolves.toHaveLength(0);
      const fresh = await prepareSemanticSearch({
        kind: "memory",
        mailboxId: mailboxIds.primary,
        query: "Travel",
        userId: actor,
      });
      expect(fresh.memoryMatches).toMatchObject([{ id, version: 2 }]);
      await db
        .update(aiMemory)
        .set({
          content: "Travel details deleted from the old representation.",
          version: sql`${aiMemory.version} + 1`,
        })
        .where(eq(aiMemory.id, id));
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.memoryId, id))
      ).resolves.toHaveLength(0);
    });

    test("deletion during inference cannot resurrect source content", async () => {
      const own = await saveChat({
        content: "Planning a quiet product release.",
      });
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(embedSearchTexts).mockImplementationOnce(async ({ values }) => {
        started.resolve(true);
        await release.promise;
        return values.map(() => semanticVector);
      });
      const pending = searchSemanticHistory({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        query: "Earlier launch plans",
        userId: actor,
      });
      await started.promise;
      await db.delete(chat).where(eq(chat.id, own.chatId));
      release.resolve(true);
      const deleted = await pending;
      expect(deleted.items).toHaveLength(0);
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.chatMessageId, own.messageId))
      ).resolves.toHaveLength(0);
    });

    test("revoking mailbox access during inference prevents both results and persisted derivatives", async () => {
      const own = await saveChat({
        content: "Planning a quiet product release.",
      });
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      vi.mocked(embedSearchTexts).mockImplementationOnce(async ({ values }) => {
        started.resolve(true);
        await release.promise;
        return values.map(() => semanticVector);
      });
      const pending = searchSemanticHistory({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        query: "Earlier launch plans",
        userId: actor,
      });
      await started.promise;
      await db
        .delete(mailboxGrant)
        .where(
          and(
            eq(mailboxGrant.mailboxId, mailboxIds.shared),
            eq(mailboxGrant.userId, actor)
          )
        );
      release.resolve(true);
      await expect(pending).rejects.toBeInstanceOf(ORPCError);
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.chatMessageId, own.messageId))
      ).resolves.toHaveLength(0);
    });

    test("chat edits and later chat deletion erase current stored chunks", async () => {
      const own = await saveChat({
        content: "Planning a quiet product release.",
      });
      await indexSemanticSources({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        userId: actor,
      });
      await db
        .update(chatMessage)
        .set({ parts: [{ text: "The release plans changed.", type: "text" }] })
        .where(eq(chatMessage.id, own.messageId));
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.chatMessageId, own.messageId))
      ).resolves.toHaveLength(0);
      await indexSemanticSources({
        kind: "chat",
        mailboxId: mailboxIds.shared,
        userId: actor,
      });
      await db.delete(chat).where(eq(chat.id, own.chatId));
      await expect(
        db
          .select({ key: semanticEmbedding.sourceKey })
          .from(semanticEmbedding)
          .where(eq(semanticEmbedding.chatMessageId, own.messageId))
      ).resolves.toHaveLength(0);
    });
  }
);
