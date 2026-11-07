import { setImmediate, setTimeout } from "node:timers/promises";

import { ORPCError } from "@orpc/server";
import {
  embedSearchTexts,
  SEARCH_EMBEDDING_MODEL_KEY,
} from "@quieter/ai/search-embeddings";
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
  mailMessageImportance,
  managedMailMessage,
  member,
  organization,
  semanticEmbedding,
  semanticSearchLease,
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

import { normalizeCapturedMailMetadata } from "../src/mail-capture-normalization";
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
      bodyHtml?: string | null;
      bodyText?: string | null;
      content: string;
      internalDate?: string | null;
      labelIds?: string[];
      legacyAnalysis?: boolean;
      mailboxId?: string;
      messageId?: string;
      subject?: string;
    }) => {
      const message = snapshot(
        input.messageId ?? crypto.randomUUID(),
        input.content
      );
      if (input.bodyHtml !== undefined) {
        message.bodyHtml = input.bodyHtml;
      }
      if (input.bodyText !== undefined) {
        message.bodyText = input.bodyText;
      }
      if (input.internalDate !== undefined) {
        message.internalDate = input.internalDate;
      }
      if (input.labelIds !== undefined) {
        message.labelIds = input.labelIds;
      }
      if (input.subject !== undefined) {
        message.headers = [{ name: "Subject", value: input.subject }];
      }
      const analysis = analyzeMailMessage(message);
      await db.insert(gmailCapturedMessage).values({
        analysis:
          input.legacyAnalysis === true
            ? {
                listId: analysis.listId,
                sender: analysis.sender,
                truncated: analysis.truncated,
                unsubscribe: analysis.unsubscribe,
                version: 1,
              }
            : analysis,
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
      bodyHtml?: string | null;
      bodyText?: string | null;
      content: string;
      legacyAnalysis?: boolean;
      sentAt?: Date;
      state?: typeof managedMailMessage.$inferInsert.mailboxState;
    }) => {
      const id = crypto.randomUUID();
      const bodyText =
        input.bodyText === undefined ? input.content : input.bodyText;
      await db.insert(managedMailMessage).values({
        analysis:
          input.legacyAnalysis === true
            ? null
            : analyzeMailMessage({
                bodyHtml: input.bodyHtml,
                bodyText,
                from: "sender@example.test",
                headers: [],
                subject: "Synthetic supplier discussion",
              }),
        bodyHtml: input.bodyHtml,
        bodyText,
        createdAt: now,
        direction: "inbound",
        from: "sender@example.test",
        id,
        mailboxId: mailboxIds.shared,
        mailboxState: input.state ?? "active",
        providerMessageId: id,
        sentAt: input.sentAt ?? now,
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

    test("mail results retain message dates when older content is captured or updated today", async () => {
      const messageDate = new Date("2015-03-04T09:30:00Z");
      const gmailId = await saveGmail({
        content: "The original travel receipt is attached.",
        internalDate: String(messageDate.getTime()),
      });
      const managedId = await saveManaged({
        content: "The original travel receipt is attached.",
        sentAt: messageDate,
      });
      for (const { mailboxId, messageId } of [
        { mailboxId: mailboxIds.primary, messageId: gmailId },
        { mailboxId: mailboxIds.shared, messageId: managedId },
      ]) {
        const result = await searchSemanticHistory({
          kind: "mail",
          mailboxId,
          query: "travel receipt",
          userId: actor,
        });
        expect(result.items).toMatchObject([
          { messageId, updatedAt: messageDate.toISOString() },
        ]);
      }
    });

    test("retained encoded Gmail subjects are readable and searchable without changing raw headers", async () => {
      const encodedSubject = "=?UTF-8?B?UsO8Y2tlcnN0YXR0dW5nIGRlciBSZWlzZQ==?=";
      const messageId = await saveGmail({
        content: "Details about the booking are included below.",
        legacyAnalysis: true,
        subject: encodedSubject,
      });
      vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) => {
        await setImmediate();
        return values.map((value) =>
          value === "Rückerstattung" ? unrelatedVector : semanticVector
        );
      });
      const result = await searchSemanticHistory({
        kind: "mail",
        mailboxId: mailboxIds.primary,
        query: "Rückerstattung",
        userId: actor,
      });
      expect(result.items).toMatchObject([{ messageId }]);
      expect(result.items[0]?.title).toMatch(/Rückerstattung der Reise/u);
      expect(result.items[0]?.snippet).toMatch(/Rückerstattung/u);
      const [stored] = await db
        .select({ snapshot: gmailCapturedMessage.snapshot })
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxIds.primary),
            eq(gmailCapturedMessage.messageId, messageId)
          )
        );
      expect(stored?.snapshot?.headers).toContainEqual({
        name: "Subject",
        value: encodedSubject,
      });
    });

    test("HTML-only mail searches readable text while excluding scripts and styles", async () => {
      const bodyHtml =
        "<style>.secretcss { color: red; }</style><script>hiddenscript()</script><p>Caf&eacute; meeting &amp; travel.</p>";
      const gmailId = await saveGmail({
        bodyHtml,
        bodyText: null,
        content: "",
        legacyAnalysis: true,
      });
      const managedId = await saveManaged({
        bodyHtml,
        bodyText: null,
        content: "",
        legacyAnalysis: true,
      });
      await saveManaged({
        bodyHtml,
        content: "A plain-text alternative takes precedence.",
      });
      vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) => {
        await setImmediate();
        return values.map((value) =>
          value === "café" ? unrelatedVector : semanticVector
        );
      });
      for (const { mailboxId, messageId } of [
        { mailboxId: mailboxIds.primary, messageId: gmailId },
        { mailboxId: mailboxIds.shared, messageId: managedId },
      ]) {
        const result = await searchSemanticHistory({
          kind: "mail",
          mailboxId,
          query: "café",
          userId: actor,
        });
        expect(result.items).toMatchObject([{ messageId }]);
        expect(result.items[0]?.snippet).toMatch(/café meeting & travel/iu);
        expect(result.items[0]?.snippet).not.toMatch(
          /secretcss|hiddenscript|&eacute;/u
        );
      }
    });

    test("unprepared subject-only and HTML-only records stay visible in incomplete coverage", async () => {
      const gmailId = await saveGmail({
        bodyText: null,
        content: "",
        legacyAnalysis: true,
        subject: "=?UTF-8?B?UsO8Y2tlcnN0YXR0dW5nIGRlciBSZWlzZQ==?=",
      });
      const managedId = await saveManaged({
        bodyHtml: "<style>hiddenstyle</style><p>Caf&eacute; booking.</p>",
        bodyText: null,
        content: "",
        legacyAnalysis: true,
      });
      for (const { mailboxId, messageId, query } of [
        {
          mailboxId: mailboxIds.primary,
          messageId: gmailId,
          query: "Rückerstattung",
        },
        { mailboxId: mailboxIds.shared, messageId: managedId, query: "café" },
      ]) {
        const token = crypto.randomUUID();
        await db.insert(semanticSearchLease).values({
          expiresAt: new Date(Date.now() + 60_000),
          mailboxId,
          token,
          userId: actor,
        });
        try {
          const pending = await searchSemanticHistory({
            kind: "mail",
            mailboxId,
            query,
            userId: actor,
          });
          expect(pending.coverage).toMatchObject({
            complete: false,
            indexedSources: 0,
            totalSources: 1,
          });
          expect(pending.items).toHaveLength(0);
        } finally {
          await db
            .delete(semanticSearchLease)
            .where(eq(semanticSearchLease.token, token));
        }
        const ready = await searchSemanticHistory({
          kind: "mail",
          mailboxId,
          query,
          userId: actor,
        });
        expect(ready.coverage.complete).toBeTruthy();
        expect(ready.items).toMatchObject([{ messageId }]);
        expect(ready.items[0]?.snippet).not.toMatch(
          /[=]\?UTF|hiddenstyle|&eacute;/u
        );
      }
    });

    test("metadata repair purges old chunks without changing raw sources or unrelated scopes", async () => {
      const messageId = await saveGmail({
        content: "A retained booking message.",
        legacyAnalysis: true,
      });
      const excludedIds: string[] = [];
      for (const label of ["DRAFT", "SPAM", "TRASH"]) {
        excludedIds.push(
          await saveGmail({
            content: "Excluded source.",
            labelIds: [label],
            legacyAnalysis: true,
          })
        );
      }
      const otherId = await saveGmail({
        content: "Other mailbox source.",
        legacyAnalysis: true,
        mailboxId: mailboxIds.secondary,
      });
      const managedId = await saveManaged({
        bodyHtml: "<p>Retained HTML.</p>",
        bodyText: null,
        content: "",
        legacyAnalysis: true,
      });
      await db
        .update(gmailCapturedMessage)
        .set({
          snapshot: sql`jsonb_set(${gmailCapturedMessage.snapshot}, '{truncation,bodyText}', 'true'::jsonb)`,
          source: "search",
        })
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxIds.primary),
            eq(gmailCapturedMessage.messageId, messageId)
          )
        );
      const [before] = await db
        .select({
          capturedAt: gmailCapturedMessage.capturedAt,
          providerRevision: gmailCapturedMessage.providerRevision,
          snapshot: gmailCapturedMessage.snapshot,
          source: gmailCapturedMessage.source,
          updatedAt: gmailCapturedMessage.updatedAt,
        })
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxIds.primary),
            eq(gmailCapturedMessage.messageId, messageId)
          )
        );
      const [managedBefore] = await db
        .select({
          bodyHtml: managedMailMessage.bodyHtml,
          bodyText: managedMailMessage.bodyText,
          sentAt: managedMailMessage.sentAt,
          updatedAt: managedMailMessage.updatedAt,
        })
        .from(managedMailMessage)
        .where(eq(managedMailMessage.id, managedId));
      if (before === undefined || managedBefore === undefined) {
        throw new Error("Missing retained-source fixtures.");
      }
      await db.insert(semanticEmbedding).values([
        {
          chunkIndex: 0,
          createdAt: now,
          embedding: semanticVector,
          gmailMailboxId: mailboxIds.primary,
          gmailMessageId: messageId,
          model: SEARCH_EMBEDDING_MODEL_KEY,
          searchText: "Old derivative.",
          sourceKey: JSON.stringify(["gmail", messageId, mailboxIds.primary]),
          sourceRevision: "legacy",
        },
        {
          chunkIndex: 0,
          createdAt: now,
          embedding: semanticVector,
          managedMessageId: managedId,
          model: SEARCH_EMBEDDING_MODEL_KEY,
          searchText: "Old derivative.",
          sourceKey: JSON.stringify(["managed", managedId, ""]),
          sourceRevision: "legacy",
        },
      ]);
      await normalizeCapturedMailMetadata({
        mailboxId: mailboxIds.primary,
        userId: actor,
      });
      await normalizeCapturedMailMetadata({
        mailboxId: mailboxIds.shared,
        userId: actor,
      });
      await expect(
        db
          .select()
          .from(semanticEmbedding)
          .where(
            inArray(semanticEmbedding.sourceKey, [
              JSON.stringify(["gmail", messageId, mailboxIds.primary]),
              JSON.stringify(["managed", managedId, ""]),
            ])
          )
      ).resolves.toHaveLength(0);
      const [after] = await db
        .select()
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, mailboxIds.primary),
            eq(gmailCapturedMessage.messageId, messageId)
          )
        );
      expect(after).toMatchObject(before);
      expect(after?.analysis?.truncated).toBeTruthy();
      const [managedAfter] = await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.id, managedId));
      expect(managedAfter).toMatchObject(managedBefore);
      const untouched = await db
        .select({ analysis: gmailCapturedMessage.analysis })
        .from(gmailCapturedMessage)
        .where(
          inArray(gmailCapturedMessage.messageId, [...excludedIds, otherId])
        );
      expect(untouched).toHaveLength(excludedIds.length + 1);
      expect(
        untouched.every((row) => row.analysis?.version === 1)
      ).toBeTruthy();
      await expect(
        db
          .select()
          .from(mailMessageImportance)
          .where(
            inArray(mailMessageImportance.mailboxId, [
              mailboxIds.primary,
              mailboxIds.shared,
            ])
          )
      ).resolves.toHaveLength(0);
      await expect(
        normalizeCapturedMailMetadata({
          mailboxId: mailboxIds.foreign,
          userId: actor,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("source changes at the same revision cannot persist stale readable metadata", async () => {
      for (const provider of ["gmail", "managed"] as const) {
        const input = {
          bodyHtml: "<p>outdatedmarker booking.</p>",
          bodyText: null,
          content: "",
          legacyAnalysis: true,
        };
        const messageId =
          provider === "gmail"
            ? await saveGmail(input)
            : await saveManaged(input);
        const mailboxId =
          provider === "gmail" ? mailboxIds.primary : mailboxIds.shared;
        let normalizing: Promise<void> | undefined;
        await db.transaction(async (tx) => {
          const [backend] = await tx.execute(
            sql`select pg_backend_pid() as pid`
          );
          if (typeof backend?.pid !== "number") {
            throw new TypeError("Missing transaction identity.");
          }
          const backendPid = backend.pid;
          if (provider === "gmail") {
            await tx
              .select()
              .from(gmailCapturedMessage)
              .where(
                and(
                  eq(gmailCapturedMessage.mailboxId, mailboxId),
                  eq(gmailCapturedMessage.messageId, messageId)
                )
              )
              .for("update");
          } else {
            await tx
              .select()
              .from(managedMailMessage)
              .where(eq(managedMailMessage.id, messageId))
              .for("update");
          }
          normalizing = normalizeCapturedMailMetadata({
            mailboxId,
            userId: actor,
          });
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const [activity] = await db.execute(
              sql`select exists (select 1 from pg_stat_activity where ${backendPid} = any(pg_blocking_pids(pid))) as blocked`
            );
            if (activity?.blocked === true) {
              blocked = true;
              break;
            }
            await setTimeout(20);
          }
          expect(blocked).toBeTruthy();
          if (provider === "gmail") {
            await tx
              .update(gmailCapturedMessage)
              .set({
                snapshot: sql`jsonb_set(${gmailCapturedMessage.snapshot}, '{bodyHtml}', ${JSON.stringify("<p>currentneedle booking.</p>")}::jsonb)`,
              })
              .where(
                and(
                  eq(gmailCapturedMessage.mailboxId, mailboxId),
                  eq(gmailCapturedMessage.messageId, messageId)
                )
              );
          } else {
            await tx
              .update(managedMailMessage)
              .set({ bodyHtml: "<p>currentneedle booking.</p>" })
              .where(eq(managedMailMessage.id, messageId));
          }
        });
        await normalizing;
        vi.mocked(embedSearchTexts).mockImplementation(async ({ values }) => {
          await setImmediate();
          return values.map((value) =>
            value === "currentneedle" ? unrelatedVector : semanticVector
          );
        });
        const result = await searchSemanticHistory({
          kind: "mail",
          mailboxId,
          query: "currentneedle",
          userId: actor,
        });
        expect(result.items).toMatchObject([{ messageId }]);
        expect(result.items[0]?.snippet).toMatch(/currentneedle/u);
        expect(result.items[0]?.snippet).not.toMatch(/outdatedmarker/u);
      }
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
