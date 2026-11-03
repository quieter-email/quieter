import { db } from "@quieter/database/client";
import {
  aiMemory as memoryRecord,
  aiMemoryChangeSet,
  gmailCapturedMessage,
  gmailLabel,
  mailAutoLabelFeedback,
  mailbox,
  mailboxGrant,
  managedMailLabel,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import type { getMessageWithDetails } from "@quieter/gmail";
import { analyzeMailMessage } from "@quieter/mail/capture";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import * as aiMemory from "../src/ai-memory";
import { hydrateMailMemoryEvent } from "../src/ai-memory-capture";
import { loadAiAgentContext } from "../src/ai-memory-context";
import {
  getSenderSource,
  recordMailAutoLabelFeedback,
  refreshAutoLabelMemoryProfile,
} from "../src/mail-automation/memory";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  getMessage: vi.fn<typeof getMessageWithDetails>(),
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
vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  getMessageWithDetails: state.getMessage,
}));
vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <TValue>(
    _input: { mailboxId: string; userId: string },
    request: (accessToken: string) => Promise<TValue>
  ): Promise<TValue> => await request("fixture-token"),
}));

describe("label feedback sender attribution", () => {
  test("uses the actual sender address when a display name contains another address", () => {
    expect(getSenderSource('"trusted@example.test" <outside@other.test>')).toBe(
      "outside@other.test"
    );
    expect(getSenderSource("trusted@example.test <invalid>")).toBeNull();
    expect(
      getSenderSource("trusted@example.test, outside@other.test")
    ).toBeNull();
  });
});

describe.skipIf(state.databaseUrl === undefined)(
  "delayed label feedback on PostgreSQL",
  () => {
    let userId = "";
    let nextOwnerId = "";
    let organizationId = "";
    let mailboxId = "";
    const labelId = "Label_launch";
    const message = {
      bodyText: "Please review the revised launch plan.",
      from: "Launch team <team@example.test>",
      id: "feedback-message",
      subject: "Launch planning",
      threadId: "feedback-thread",
      to: "owner@example.test",
    };

    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Label feedback tests require loopback quieter_migration_test."
        );
      }
    });

    beforeEach(async () => {
      userId = crypto.randomUUID();
      nextOwnerId = crypto.randomUUID();
      organizationId = crypto.randomUUID();
      mailboxId = crypto.randomUUID();
      const now = new Date();
      await db.insert(user).values(
        [userId, nextOwnerId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Label memory test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Label memory test",
        slug: organizationId,
      });
      await db.insert(member).values(
        [userId, nextOwnerId].map((id) => ({
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
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
      await db.insert(gmailLabel).values({
        createdAt: now,
        labelId,
        mailboxId,
        name: "Launch planning",
        updatedAt: now,
      });
      state.getMessage.mockReset().mockResolvedValue(message);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, nextOwnerId]));
    });

    afterAll(async () => {
      await db.$client.end();
    });

    test("learns a retained Gmail sender's first label correction and removal without provider reads", async () => {
      const now = new Date();
      const snapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: message.bodyText,
        headers: [
          { name: "From", value: message.from },
          { name: "To", value: message.to },
          { name: "Subject", value: message.subject },
        ],
        id: message.id,
        internalDate: String(now.getTime()),
        labelIds: [labelId],
        providerRevision: "100",
        threadId: message.threadId,
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
      };
      await db.insert(gmailCapturedMessage).values({
        analysis: analyzeMailMessage(snapshot),
        capturedAt: now,
        mailboxId,
        messageId: message.id,
        providerRevision: snapshot.providerRevision,
        snapshot,
        source: "on_demand",
        updatedAt: now,
      });

      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        providerMessageIds: [message.id],
        userId,
      });
      const added = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId,
      });
      expect(added.memory).toStrictEqual(
        expect.stringContaining("team@example.test")
      );
      expect(added.memory).toContain("Launch planning");

      await recordMailAutoLabelFeedback({
        mailboxId,
        providerMessageIds: [message.id],
        removeLabelIds: [labelId],
        userId,
      });
      const removed = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId,
      });
      expect(removed.memory).toContain("team@example.test");
      const policies = await db
        .select({ metadata: memoryRecord.metadata })
        .from(memoryRecord)
        .where(eq(memoryRecord.userId, userId));
      expect(
        policies.find(({ metadata }) =>
          (metadata.feedbackMembers ?? []).some(
            ({ source, policy }) =>
              source === "team@example.test" && policy === "suppress"
          )
        )?.metadata.policy
      ).toBe("suppress");
      expect(state.getMessage).not.toHaveBeenCalled();
    });

    test("refreshes grouped rules idempotently and forgetting removes every source without resurrection", async () => {
      const sources = {
        first: "first@example.test",
        second: "second@example.test",
        third: "third@other.test",
      };
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: sources,
        providerMessageIds: Object.keys(sources),
        userId,
      });
      const before = await aiMemory.searchAiMemory({ userId });
      expect(before.items).toHaveLength(1);
      const [learned] = before.items;
      if (learned === undefined) {
        throw new Error("Expected grouped feedback.");
      }
      expect(
        Object.values(sources).every((source) =>
          learned.content.includes(source)
        )
      ).toBeTruthy();
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const refreshed = await aiMemory.searchAiMemory({ userId });
      expect(refreshed.items[0]).toMatchObject({
        id: learned.id,
        version: learned.version,
      });
      await aiMemory.forgetAiMemory({ memoryId: learned.id, userId });
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const forgotten = await aiMemory.searchAiMemory({ userId });
      expect(forgotten.items).toHaveLength(0);
      await expect(
        db
          .select()
          .from(mailAutoLabelFeedback)
          .where(eq(mailAutoLabelFeedback.createdByUserId, userId))
      ).resolves.toHaveLength(0);
    });

    test("forgetting a group erases archived overlapping projections and history while retaining unrelated evidence", async () => {
      const forgottenSource = "forgotten@example.test";
      const retainedSource = "retained@example.test";
      const { revision } =
        await aiMemory.getPersonalAiMemoryScopeConfig(userId);
      await aiMemory.replaceAiMemoryFeedback({
        agent: "auto_label",
        expectedRevision: revision,
        mailboxId,
        memories: [
          {
            confidence: 0.8,
            content: forgottenSource,
            importance: 4,
            key: "legacy-singleton",
            metadata: { feedbackSource: forgottenSource, labelId },
            reinforcementCount: 1,
            summary: "Legacy singleton",
            topics: [],
          },
          {
            confidence: 0.8,
            content: `${forgottenSource}, ${retainedSource}`,
            importance: 4,
            key: "previous-chunk",
            metadata: {
              feedbackMembers: [forgottenSource, retainedSource].map(
                (source) => ({
                  labelId,
                  policy: "prefer",
                  source,
                })
              ),
            },
            reinforcementCount: 2,
            summary: "Previous chunk",
            topics: [],
          },
        ],
        userId,
      });
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { forgotten: forgottenSource },
        providerMessageIds: ["forgotten"],
        userId,
      });
      await recordMailAutoLabelFeedback({
        mailboxId,
        messageSources: { retained: retainedSource },
        providerMessageIds: ["retained"],
        removeLabelIds: [labelId],
        userId,
      });
      const current = await aiMemory.searchAiMemory({ userId });
      const grouped = current.items.find(({ content }) =>
        content.includes(forgottenSource)
      );
      if (grouped === undefined) {
        throw new Error("Expected current grouped feedback.");
      }
      const [template] = await db
        .select()
        .from(memoryRecord)
        .where(eq(memoryRecord.id, grouped.id));
      if (template === undefined) {
        throw new Error("Expected feedback fixture.");
      }
      const preserved = [
        {
          ...template,
          id: crypto.randomUUID(),
          key: `${template.key}:unrelated-active`,
        },
        {
          ...template,
          id: crypto.randomUUID(),
          key: `${template.key}:explicit-copy`,
          source: "explicit" as const,
          status: "archived" as const,
        },
        {
          ...template,
          id: crypto.randomUUID(),
          key: `${template.key}:other-mailbox`,
          metadata: {
            ...template.metadata,
            sourceMailboxId: crypto.randomUUID(),
          },
          status: "archived" as const,
        },
        {
          ...template,
          content: "Unrelated sender",
          id: crypto.randomUUID(),
          key: `${template.key}:other-source`,
          metadata: {
            ...template.metadata,
            feedbackMembers: [
              {
                labelId,
                policy: "prefer" as const,
                source: "other@example.test",
              },
            ],
          },
          status: "archived" as const,
        },
        {
          ...template,
          content: "Unrelated label",
          id: crypto.randomUUID(),
          key: `${template.key}:other-label`,
          metadata: {
            ...template.metadata,
            feedbackMembers: [
              {
                labelId: "other-label",
                policy: "prefer" as const,
                source: forgottenSource,
              },
            ],
          },
          status: "archived" as const,
        },
        {
          ...template,
          id: crypto.randomUUID(),
          key: `${template.key}:other-owner`,
          scopeKey: `user:${nextOwnerId}`,
          status: "archived" as const,
          userId: nextOwnerId,
        },
      ];
      await db.insert(memoryRecord).values(preserved);
      await aiMemory.forgetAiMemory({ memoryId: grouped.id, userId });
      const exported = await aiMemory.exportPersonalAiMemory(userId);
      expect(
        exported.memories.filter(({ content }) =>
          content.includes(forgottenSource)
        )
      ).toHaveLength(3);
      const history = await db
        .select()
        .from(aiMemoryChangeSet)
        .where(eq(aiMemoryChangeSet.userId, userId));
      expect(JSON.stringify(history)).not.toContain(forgottenSource);
      const remaining = await db
        .select()
        .from(memoryRecord)
        .where(
          inArray(
            memoryRecord.id,
            preserved.map(({ id }) => id)
          )
        );
      expect(remaining).toHaveLength(preserved.length);
      const evidence = await db
        .select()
        .from(mailAutoLabelFeedback)
        .where(eq(mailAutoLabelFeedback.createdByUserId, userId));
      expect(evidence.map(({ source }) => source)).toStrictEqual([
        retainedSource,
      ]);
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const refreshed = await aiMemory.searchAiMemory({ userId });
      expect(
        refreshed.items.some(({ content }) => content.includes(retainedSource))
      ).toBeTruthy();
    });

    test("forgetting a shifted sender erases snapshots from a still-active group", async () => {
      const sources = Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `message-${index}`,
          `sender-${String(index).padStart(2, "0")}@example.test`,
        ])
      );
      const forgottenSource = "sender-19@example.test";
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: sources,
        providerMessageIds: Object.keys(sources),
        userId,
      });
      const original = await aiMemory.searchAiMemory({ userId });
      const [originalGroup] = original.items;
      if (originalGroup === undefined) {
        throw new Error("Expected original sender group.");
      }
      const [originalHistory] = await db
        .select()
        .from(aiMemoryChangeSet)
        .where(eq(aiMemoryChangeSet.userId, userId));
      const snapshot = originalHistory?.changes[0]?.after;
      if (
        originalHistory === undefined ||
        snapshot === null ||
        snapshot === undefined
      ) {
        throw new Error("Expected original projection history.");
      }
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { earlier: "aaa@example.test" },
        providerMessageIds: ["earlier"],
        userId,
      });
      const shifted = await aiMemory.searchAiMemory({ userId });
      const forgotten = shifted.items.find(({ content }) =>
        content.includes(forgottenSource)
      );
      if (forgotten === undefined) {
        throw new Error("Expected shifted sender group.");
      }
      expect(forgotten.id).not.toBe(originalGroup.id);
      expect(shifted.items).toContainEqual(
        expect.objectContaining({ id: originalGroup.id })
      );
      const preservedHistory = [
        { source: "settings" as const },
        { userId: nextOwnerId },
        {
          metadata: {
            ...snapshot.metadata,
            sourceMailboxId: crypto.randomUUID(),
          },
        },
        {
          metadata: {
            ...snapshot.metadata,
            feedbackMembers: [
              {
                labelId: "other-label",
                policy: "prefer" as const,
                source: forgottenSource,
              },
            ],
          },
        },
        {
          metadata: {
            ...snapshot.metadata,
            feedbackMembers: [
              {
                labelId,
                policy: "prefer" as const,
                source: "other@example.test",
              },
            ],
          },
        },
      ].map(({ metadata = snapshot.metadata, ...overrides }) => ({
        ...originalHistory,
        changes: [
          {
            after: { ...snapshot, metadata },
            before: null,
            memoryId: crypto.randomUUID(),
            operation: "add" as const,
          },
        ],
        id: crypto.randomUUID(),
        ...overrides,
      }));
      await db.insert(aiMemoryChangeSet).values(preservedHistory);
      await aiMemory.forgetAiMemory({ memoryId: forgotten.id, userId });
      const history = await db
        .select()
        .from(aiMemoryChangeSet)
        .where(eq(aiMemoryChangeSet.userId, userId));
      expect(
        JSON.stringify(
          history.filter(
            ({ id }) => !preservedHistory.some((entry) => entry.id === id)
          )
        )
      ).not.toContain(forgottenSource);
      const preserved = await db
        .select()
        .from(aiMemoryChangeSet)
        .where(
          inArray(
            aiMemoryChangeSet.id,
            preservedHistory.map(({ id }) => id)
          )
        );
      expect(preserved).toHaveLength(preservedHistory.length);
      const remaining = await aiMemory.searchAiMemory({ userId });
      expect(remaining.items).toContainEqual(
        expect.objectContaining({ id: originalGroup.id })
      );
      const evidence = await db
        .select()
        .from(mailAutoLabelFeedback)
        .where(eq(mailAutoLabelFeedback.createdByUserId, userId));
      expect(evidence.map(({ source }) => source)).not.toContain(
        forgottenSource
      );
      expect(evidence.map(({ source }) => source)).toContain(
        "sender-00@example.test"
      );
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const refreshed = await aiMemory.searchAiMemory({ userId });
      expect(
        refreshed.items.some(({ content }) => content.includes(forgottenSource))
      ).toBeFalsy();
    });

    test("keeps domain rules available alongside exact-address rules", async () => {
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: {
          domain: "special.example",
          person: "alice@other.test",
        },
        providerMessageIds: ["domain", "person"],
        userId,
      });

      const domainContext = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: "A project update from bob@special.example",
        userId,
      });
      expect(domainContext.memory).toStrictEqual(
        expect.stringContaining("special.example")
      );
      expect(domainContext.memory).not.toContain("alice@other.test");

      const personContext = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: "A project update from alice@other.test",
        userId,
      });
      expect(personContext.memory).toContain("alice@other.test");
    });

    test("updates an existing group when a new sender fits and preserves its explicit edits on later evidence", async () => {
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { first: "first@example.test" },
        providerMessageIds: ["first"],
        userId,
      });
      const initial = await aiMemory.searchAiMemory({ userId });
      const [original] = initial.items;
      if (original === undefined) {
        throw new Error("Expected initial group.");
      }
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { second: "second@example.test" },
        providerMessageIds: ["second"],
        userId,
      });
      const expanded = await aiMemory.searchAiMemory({ userId });
      expect(expanded.items).toHaveLength(1);
      const [grouped] = expanded.items;
      if (grouped === undefined) {
        throw new Error("Expected expanded group.");
      }
      expect(grouped.id).toBe(original.id);
      expect(grouped.content).toContain("second@example.test");
      await aiMemory.saveAiMemory({
        category: "labeling",
        content: "My edited rule.",
        memoryId: grouped.id,
        userId,
        version: grouped.version,
      });
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { third: "third@example.test" },
        providerMessageIds: ["third"],
        userId,
      });
      const after = await aiMemory.searchAiMemory({ userId });
      expect(after.items).toHaveLength(2);
      const automatic = after.items.find(({ source }) => source === "feedback");
      expect(automatic?.content).toContain("third@example.test");
      expect(automatic?.content).not.toContain("first@example.test");
      expect(automatic?.content).not.toContain("second@example.test");
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const repeated = await aiMemory.searchAiMemory({ userId });
      expect(
        repeated.items.find(({ source }) => source === "feedback")?.id
      ).toBe(automatic?.id);
    });

    test("retires old automatic label summaries only within the refreshed mailbox", async () => {
      const now = new Date();
      const ids = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      await db.insert(memoryRecord).values(
        ids.map((id, index) => ({
          content: "A historical label summary.",
          createdAt: now,
          id,
          importance: 3,
          key: id,
          kind: "learned" as const,
          lastConfirmedAt: now,
          metadata: {
            category: "labeling" as const,
            sourceMailboxId: index === 2 ? "other-mailbox" : mailboxId,
          },
          scope: "user" as const,
          scopeKey: `user:${userId}`,
          source: index === 1 ? ("explicit" as const) : ("feedback" as const),
          summary: "Historical label handling",
          updatedAt: now,
          userId,
        }))
      );
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const records = await db
        .select()
        .from(memoryRecord)
        .where(eq(memoryRecord.userId, userId));
      expect(records.find(({ id }) => id === ids[0])?.status).toBe("archived");
      expect(records.find(({ id }) => id === ids[1])?.status).toBe("active");
      expect(records.find(({ id }) => id === ids[2])?.status).toBe("active");
    });

    test("preserves edited legacy projection evidence while archiving its unedited siblings", async () => {
      const config = await aiMemory.getPersonalAiMemoryScopeConfig(userId);
      await aiMemory.replaceAiMemoryFeedback({
        agent: "auto_label",
        expectedRevision: config.revision,
        mailboxId,
        memories: ["first@example.test", "second@example.test"].map(
          (source) => ({
            confidence: 0.8,
            content: `Prefer Launch planning for ${source}.`,
            importance: 4,
            key: source,
            metadata: {
              correspondents: [source],
              feedbackSource: source,
              labelId,
              policy: "prefer",
            },
            reinforcementCount: 1,
            summary: "Launch planning",
            topics: ["labeling"],
          })
        ),
        userId,
      });
      const old = await aiMemory.searchAiMemory({ userId });
      const first = old.items.find(({ content }) =>
        content.includes("first@example.test")
      );
      const second = old.items.find(({ content }) =>
        content.includes("second@example.test")
      );
      if (!first || !second) {
        throw new Error("Expected legacy projections.");
      }
      await aiMemory.saveAiMemory({
        category: "labeling",
        content: "Keep my carefully edited rule.",
        memoryId: first.id,
        userId,
        version: first.version,
      });
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: {
          first: "first@example.test",
          second: "second@example.test",
        },
        providerMessageIds: ["first", "second"],
        userId,
      });
      const after = await aiMemory.searchAiMemory({ userId });
      expect(after.items).toHaveLength(2);
      expect(after.items.find(({ id }) => id === first.id)?.content).toContain(
        "carefully edited"
      );
      const automatic = after.items.filter(
        ({ source }) => source !== "explicit"
      );
      expect(automatic).toHaveLength(1);
      expect(automatic[0]?.content).toContain("second@example.test");
      expect(automatic[0]?.content).not.toContain("first@example.test");
      const [archived] = await db
        .select()
        .from(memoryRecord)
        .where(eq(memoryRecord.id, second.id));
      expect(archived?.status).toBe("archived");
    });

    test("excludes deleted and foreign captures with the same message ID from sender feedback", async () => {
      const now = new Date();
      const otherMailboxId = crypto.randomUUID();
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: `${otherMailboxId}@example.test`,
        id: otherMailboxId,
        organizationId,
        ownerUserId: nextOwnerId,
        provider: "gmail",
        updatedAt: now,
      });
      const snapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: message.bodyText,
        headers: [{ name: "From", value: "private@elsewhere.test" }],
        id: message.id,
        internalDate: String(now.getTime()),
        labelIds: [labelId],
        providerRevision: "100",
        threadId: message.threadId,
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
      };
      await db.insert(gmailCapturedMessage).values([
        {
          analysis: null,
          capturedAt: now,
          deletedAt: now,
          mailboxId,
          messageId: message.id,
          providerRevision: snapshot.providerRevision,
          snapshot: null,
          source: "on_demand",
          updatedAt: now,
        },
        {
          analysis: analyzeMailMessage(snapshot),
          capturedAt: now,
          mailboxId: otherMailboxId,
          messageId: message.id,
          providerRevision: snapshot.providerRevision,
          snapshot,
          source: "on_demand",
          updatedAt: now,
        },
      ]);

      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        providerMessageIds: [message.id],
        userId,
      });
      const [feedback] = await db
        .select({ source: mailAutoLabelFeedback.source })
        .from(mailAutoLabelFeedback)
        .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId));
      expect(feedback).toMatchObject({ source: null });
      const context = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: "private@elsewhere.test",
        userId,
      });
      expect(context.memory).toBeNull();
      expect(state.getMessage).not.toHaveBeenCalled();
    });

    test("makes the first sender-specific correction available after delayed hydration without another action", async () => {
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        providerMessageIds: [message.id],
        userId,
      });
      const before = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId,
      });
      expect(before.memory).toBeNull();

      await hydrateMailMemoryEvent({
        mailboxId,
        messageId: message.id,
        userId,
      });

      const after = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId,
      });
      expect(after.memory).toContain("team@example.test");
      expect(after.memory).toContain("Launch planning");
    });

    test("does not retain corrections made while learning is paused for later profile refresh", async () => {
      const config = await aiMemory.getPersonalAiMemoryScopeConfig(userId);
      const paused = await aiMemory.updateAiMemoryScopeConfig({
        ...config,
        activeLearningEnabled: false,
        userId,
      });
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { [message.id]: "team@example.test" },
        providerMessageIds: [message.id],
        userId,
      });
      await expect(
        db
          .select()
          .from(mailAutoLabelFeedback)
          .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId))
      ).resolves.toHaveLength(0);

      await aiMemory.updateAiMemoryScopeConfig({
        ...paused,
        activeLearningEnabled: true,
        userId,
      });
      await refreshAutoLabelMemoryProfile(mailboxId, userId);
      const context = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId,
      });
      expect(context.memory).toBeNull();
    });

    test("discards an in-flight correction across a pause and resume before feedback capture", async () => {
      const readConfig = aiMemory.getPersonalAiMemoryScopeConfig;
      const configRead =
        Promise.withResolvers<Awaited<ReturnType<typeof readConfig>>>();
      const release = Promise.withResolvers<null>();
      vi.spyOn(
        aiMemory,
        "getPersonalAiMemoryScopeConfig"
      ).mockImplementationOnce(async (actorUserId) => {
        const config = await readConfig(actorUserId);
        configRead.resolve(config);
        await release.promise;
        return config;
      });
      const correction = recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { [message.id]: "team@example.test" },
        providerMessageIds: [message.id],
        userId,
      });
      const config = await configRead.promise;
      try {
        const paused = await aiMemory.updateAiMemoryScopeConfig({
          ...config,
          activeLearningEnabled: false,
          userId,
        });
        await aiMemory.updateAiMemoryScopeConfig({
          ...paused,
          activeLearningEnabled: true,
          userId,
        });
        release.resolve(null);
        await correction;
        await expect(
          db
            .select()
            .from(mailAutoLabelFeedback)
            .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId))
        ).resolves.toHaveLength(0);

        await refreshAutoLabelMemoryProfile(mailboxId, userId);
        const context = await loadAiAgentContext({
          agent: "auto_label",
          mailboxId,
          query: message.from,
          userId,
        });
        expect(context.memory).toBeNull();
      } finally {
        release.resolve(null);
        await correction;
      }
    });

    test("retries a failed profile refresh after the sender was already hydrated", async () => {
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        providerMessageIds: [message.id],
        userId,
      });
      vi.spyOn(aiMemory, "replaceAiMemoryFeedback").mockRejectedValueOnce(
        new Error("Fixture profile refresh unavailable.")
      );
      await expect(
        hydrateMailMemoryEvent({ mailboxId, messageId: message.id, userId })
      ).rejects.toThrow("Fixture profile refresh unavailable.");

      await hydrateMailMemoryEvent({
        mailboxId,
        messageId: message.id,
        userId,
      });
      const context = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId,
      });
      expect(context.memory).toContain("team@example.test");
      expect(context.memory).toContain("Launch planning");
    });

    test("keeps edited feedback forgotten when unrelated corrections refresh the profile", async () => {
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        messageSources: { [message.id]: "team@example.test" },
        providerMessageIds: [message.id],
        userId,
      });
      const before = await aiMemory.searchAiMemory({
        userId,
      });
      const [learned] = before.items;
      if (learned === undefined) {
        throw new Error("The label correction did not create a memory.");
      }
      const edited = await aiMemory.saveAiMemory({
        category: "activity",
        content: "Keep launch updates available for later review.",
        correspondents: ["reviewer@elsewhere.test"],
        memoryId: learned.id,
        userId,
        version: learned.version,
      });
      expect(edited).toMatchObject({
        category: "activity",
        correspondents: ["reviewer@elsewhere.test"],
        source: "explicit",
      });
      const [stored] = await db
        .select({ metadata: memoryRecord.metadata })
        .from(memoryRecord)
        .where(eq(memoryRecord.id, edited.id));

      await aiMemory.forgetAiMemory({
        memoryId: edited.id,
        userId,
      });
      const otherLabelId = "Label_travel";
      const now = new Date();
      await db.insert(gmailLabel).values({
        createdAt: now,
        labelId: otherLabelId,
        mailboxId,
        name: "Travel receipts",
        updatedAt: now,
      });
      await recordMailAutoLabelFeedback({
        addLabelIds: [otherLabelId],
        mailboxId,
        messageSources: { "travel-message": "receipts@travel.test" },
        providerMessageIds: ["travel-message"],
        userId,
      });

      const after = await aiMemory.searchAiMemory({
        userId,
      });
      expect(after.items).toHaveLength(1);
      expect(after.items[0]?.content).toContain("Travel receipts");
      const forgottenFeedback = await db
        .select({ id: mailAutoLabelFeedback.id })
        .from(mailAutoLabelFeedback)
        .where(
          and(
            eq(mailAutoLabelFeedback.mailboxId, mailboxId),
            eq(mailAutoLabelFeedback.labelId, labelId)
          )
        );
      expect(forgottenFeedback).toHaveLength(0);
      expect(stored?.metadata.sourceDomains).toContain("example.test");
    });

    test.each([
      {
        erase: async (memoryId: string) =>
          await aiMemory.forgetAiMemory({
            memoryId,
            userId,
          }),
        operation: "delete",
      },
      {
        erase: async (_memoryId: string) =>
          await aiMemory.purgePersonalAiMemory(userId),
        operation: "reset",
      },
    ])(
      "does not restore sender facts when $operation happens during profile replacement",
      async ({ erase }) => {
        await recordMailAutoLabelFeedback({
          addLabelIds: [labelId],
          mailboxId,
          messageSources: { [message.id]: "team@example.test" },
          providerMessageIds: [message.id],
          userId,
        });
        const pendingMessageId = "pending-feedback-message";
        await recordMailAutoLabelFeedback({
          addLabelIds: [labelId],
          mailboxId,
          providerMessageIds: [pendingMessageId],
          userId,
        });
        const saved = await aiMemory.searchAiMemory({
          userId,
        });
        expect(saved.items).toHaveLength(1);

        const entered = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const replace = aiMemory.replaceAiMemoryFeedback;
        vi.spyOn(aiMemory, "replaceAiMemoryFeedback").mockImplementationOnce(
          async (input) => {
            entered.resolve(true);
            await release.promise;
            return await replace(input);
          }
        );
        state.getMessage.mockResolvedValueOnce({
          ...message,
          id: pendingMessageId,
        });
        const hydration = hydrateMailMemoryEvent({
          mailboxId,
          messageId: pendingMessageId,
          userId,
        });
        try {
          await entered.promise;
          await erase(saved.items[0]?.id ?? "");
        } finally {
          release.resolve(true);
          await hydration;
        }

        const after = await loadAiAgentContext({
          agent: "auto_label",
          mailboxId,
          query: message.from,
          userId,
        });
        expect(after.memory).toBeNull();
      }
    );

    test.each(["delete", "reset"])(
      "keeps shared-mailbox corrections private and preserves another actor's evidence after %s",
      async (operation) => {
        const sharedMailboxId = crypto.randomUUID();
        const sharedLabelId = crypto.randomUUID();
        const now = new Date();
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
          [userId, nextOwnerId].map(
            (id) =>
              ({
                createdAt: now,
                id: crypto.randomUUID(),
                mailboxId: sharedMailboxId,
                role: id === userId ? "reader" : "manager",
                updatedAt: now,
                userId: id,
              }) satisfies typeof mailboxGrant.$inferInsert
          )
        );
        await db.insert(managedMailLabel).values({
          createdAt: now,
          id: sharedLabelId,
          mailboxId: sharedMailboxId,
          name: "Launch planning",
          normalizedName: "launch planning",
          updatedAt: now,
        });
        await recordMailAutoLabelFeedback({
          addLabelIds: [sharedLabelId],
          mailboxId: sharedMailboxId,
          messageSources: { "reader-message": "team@example.test" },
          providerMessageIds: ["reader-message"],
          userId,
        });
        await recordMailAutoLabelFeedback({
          mailboxId: sharedMailboxId,
          messageSources: { "manager-message": "team@example.test" },
          providerMessageIds: ["manager-message"],
          removeLabelIds: [sharedLabelId],
          userId: nextOwnerId,
        });
        const reader = await aiMemory.searchAiMemory({ userId });
        const manager = await aiMemory.searchAiMemory({ userId: nextOwnerId });
        expect(reader.items).toHaveLength(1);
        expect(manager.items).toHaveLength(1);
        const policies = await db
          .select({
            metadata: memoryRecord.metadata,
            userId: memoryRecord.userId,
          })
          .from(memoryRecord)
          .where(inArray(memoryRecord.userId, [userId, nextOwnerId]));
        expect(
          policies.find((entry) => entry.userId === userId)?.metadata.policy
        ).toBe("prefer");
        expect(
          policies.find((entry) => entry.userId === nextOwnerId)?.metadata
            .policy
        ).toBe("suppress");

        if (operation === "delete") {
          await aiMemory.forgetAiMemory({
            memoryId: reader.items[0]?.id ?? "",
            userId,
          });
        } else {
          await aiMemory.purgePersonalAiMemory(userId);
        }
        const remainingEvidence = await db
          .select({ createdByUserId: mailAutoLabelFeedback.createdByUserId })
          .from(mailAutoLabelFeedback)
          .where(eq(mailAutoLabelFeedback.mailboxId, sharedMailboxId));
        expect(remainingEvidence).toHaveLength(1);
        expect(remainingEvidence[0]?.createdByUserId).toBe(nextOwnerId);
        await refreshAutoLabelMemoryProfile(sharedMailboxId, userId);
        await refreshAutoLabelMemoryProfile(sharedMailboxId, nextOwnerId);
        const erased = await aiMemory.searchAiMemory({ userId });
        expect(erased.items).toHaveLength(0);
        const preserved = await aiMemory.searchAiMemory({
          userId: nextOwnerId,
        });
        expect(preserved.items).toHaveLength(1);
        expect(preserved.items[0]?.content).toBe(manager.items[0]?.content);
      }
    );

    test("keeps long label and sender keys distinct across the user's mailboxes", async () => {
      const secondMailboxId = crypto.randomUUID();
      const now = new Date();
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
      const longLabelId = `Label_${"project".repeat(22)}`;
      const sender = `${"person".repeat(10)}@${"dept".repeat(12)}.${"mail".repeat(10)}.example.test`;
      for (const evidenceMailboxId of [mailboxId, secondMailboxId]) {
        await recordMailAutoLabelFeedback({
          addLabelIds: [longLabelId],
          mailboxId: evidenceMailboxId,
          messageSources: { "long-feedback": sender },
          providerMessageIds: ["long-feedback"],
          userId,
        });
      }
      const memories = await aiMemory.searchAiMemory({ userId });
      expect(memories.items).toHaveLength(2);
      const sources = await db
        .select({ metadata: memoryRecord.metadata })
        .from(memoryRecord)
        .where(eq(memoryRecord.userId, userId));
      expect(
        new Set(sources.map(({ metadata }) => metadata.sourceMailboxId))
      ).toStrictEqual(new Set([mailboxId, secondMailboxId]));
    });

    test("does not adopt a new owner while the previous owner's message hydration is in flight", async () => {
      await recordMailAutoLabelFeedback({
        addLabelIds: [labelId],
        mailboxId,
        providerMessageIds: [message.id],
        userId,
      });
      const entered = Promise.withResolvers<boolean>();
      const release =
        Promise.withResolvers<
          Awaited<ReturnType<typeof getMessageWithDetails>>
        >();
      state.getMessage.mockImplementationOnce(async () => {
        entered.resolve(true);
        return await release.promise;
      });
      const hydration = hydrateMailMemoryEvent({
        mailboxId,
        messageId: message.id,
        userId,
      });
      try {
        await entered.promise;
        await db
          .update(mailbox)
          .set({ ownerUserId: nextOwnerId })
          .where(eq(mailbox.id, mailboxId));
      } finally {
        release.resolve(message);
        await hydration;
      }

      const after = await loadAiAgentContext({
        agent: "auto_label",
        mailboxId,
        query: message.from,
        userId: nextOwnerId,
      });
      expect(after.memory).toBeNull();
      const feedback = await db
        .select({ source: mailAutoLabelFeedback.source })
        .from(mailAutoLabelFeedback)
        .where(eq(mailAutoLabelFeedback.mailboxId, mailboxId));
      expect(feedback.every((entry) => entry.source === null)).toBeTruthy();
    });
  }
);
