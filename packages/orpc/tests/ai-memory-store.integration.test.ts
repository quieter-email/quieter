import type {
  AiMemoryUpdatePlan,
  classifyAiMemoryEditIntent,
  planAiMemoryUpdate,
} from "@quieter/ai/ai-memory";
import type { reportAiUsage } from "@quieter/billing";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  aiMemory,
  aiMemoryChangeSet,
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  mailbox,
  mailboxGrant,
  managedMailMessage,
  member,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import type { getMessageWithDetails } from "@quieter/gmail";
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

import {
  exportPersonalAiMemory,
  forgetAiMemory,
  learnAiMemoryFromChatMessage,
  learnAiMemoryFromMailAction,
  purgePersonalAiMemory,
  recordAiMemoryEvent,
  refreshAiMemoryFromEvent,
  requestAiMemoryUpdate,
  saveAiMemory,
  searchAiMemory,
} from "../src/ai-memory";
import {
  captureMailboxMessageMemory,
  getMailboxMemoryActor,
} from "../src/ai-memory-capture";
import { learnAiMemoryFromGmailAction } from "../src/mail/feedback";

const state = vi.hoisted(() => ({
  billed: vi.fn<typeof reportAiUsage>(),
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  getMessage: vi.fn<typeof getMessageWithDetails>(),
  intent: vi.fn<typeof classifyAiMemoryEditIntent>(),
  plan: vi.fn<typeof planAiMemoryUpdate>(),
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
vi.mock(import("@quieter/ai/ai-memory"), async (original) => ({
  ...(await original()),
  classifyAiMemoryEditIntent: state.intent,
  planAiMemoryUpdate: state.plan,
}));
vi.mock(import("@quieter/billing/entitlements"), async (original) => ({
  ...(await original()),
  hasUserBillingFeature: state.entitlement,
}));
vi.mock(import("@quieter/billing"), async (original) => ({
  ...(await original()),
  reportAiUsage: state.billed,
}));
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

const addition = {
  action: "add",
  agents: ["all"],
  category: "preferences",
  confidence: 0.8,
  content: "Prefers quiet mornings.",
  correspondents: [],
  expiresAt: null,
  importance: 3,
  key: "quiet-mornings",
  kind: "learned",
  summary: "Quiet mornings",
  targetId: null,
  topics: ["morning"],
} satisfies AiMemoryUpdatePlan["operations"][number];
const defaultPlan = {
  answer: "Saved the requested information.",
  operations: [addition],
  summary: "Updated personal knowledge.",
} satisfies AiMemoryUpdatePlan;

describe.skipIf(state.databaseUrl === undefined)(
  "plain-text memory ownership and work invalidation on PostgreSQL",
  () => {
    let userId = "";
    let otherUserId = "";
    let organizationId = "";
    let mailboxId = "";

    const createManagedMailbox = async (role: "manager" | "reader") => {
      const id = crypto.randomUUID();
      const now = new Date();
      await db.insert(mailbox).values({
        accessMode: "shared",
        createdAt: now,
        emailAddress: `${id}@example.test`,
        id,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      await db.insert(mailboxGrant).values({
        createdAt: now,
        id: crypto.randomUUID(),
        mailboxId: id,
        role,
        updatedAt: now,
        userId,
      });
      return id;
    };

    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Memory store tests require loopback quieter_migration_test."
        );
      }
    });

    beforeEach(async () => {
      vi.resetAllMocks();
      state.entitlement.mockResolvedValue({
        account: null,
        hasAccess: true,
        hasUnlimitedAccess: true,
        product: null,
      });
      state.plan.mockResolvedValue(defaultPlan);
      state.intent.mockResolvedValue("add");
      userId = crypto.randomUUID();
      otherUserId = crypto.randomUUID();
      organizationId = crypto.randomUUID();
      mailboxId = crypto.randomUUID();
      const now = new Date();
      await db.insert(user).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Memory ownership test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Memory ownership test",
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
        createdAt: now,
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        updatedAt: now,
      });
    });

    afterEach(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
    });

    afterAll(async () => {
      await db.$client.end();
    });

    test("saves explicit facts while learning is paused and rejects stale or foreign edits", async () => {
      const now = new Date();
      await db.insert(aiMemoryScopeConfig).values({
        activeLearningEnabled: false,
        createdAt: now,
        id: crypto.randomUUID(),
        scope: "user",
        scopeKey: `user:${userId}`,
        updatedAt: now,
        userId,
      });
      const saved = await saveAiMemory({
        category: "writing_style",
        content: "Use short, warm replies.",
        correspondents: ["Friend@Example.test"],
        userId,
      });
      expect(saved).toMatchObject({
        category: "writing_style",
        correspondents: ["friend@example.test"],
        source: "explicit",
      });
      const edited = await saveAiMemory({
        category: "writing_style",
        content: "Use short, warm replies with a personal greeting.",
        memoryId: saved.id,
        userId,
        version: saved.version,
      });
      expect(edited.content).toContain("personal greeting");
      await expect(
        saveAiMemory({
          category: "writing_style",
          content: "A stale edit",
          memoryId: saved.id,
          userId,
          version: saved.version,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        saveAiMemory({
          category: "writing_style",
          content: "A foreign edit",
          memoryId: saved.id,
          userId: crypto.randomUUID(),
          version: edited.version,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(state.plan).not.toHaveBeenCalled();
      expect(state.billed).not.toHaveBeenCalled();
    });

    test("explicit chat additions finish while paused and rejected operations do not claim success", async () => {
      const now = new Date();
      await db.insert(aiMemoryScopeConfig).values({
        activeLearningEnabled: false,
        createdAt: now,
        id: crypto.randomUUID(),
        scope: "user",
        scopeKey: `user:${userId}`,
        updatedAt: now,
        userId,
      });
      const input = {
        bodyText: "Remember that I prefer quiet mornings.",
        mailboxId,
        messageId: crypto.randomUUID(),
        userId,
      };
      await expect(learnAiMemoryFromChatMessage(input)).resolves.toMatchObject({
        explicit: true,
        status: "refreshed",
      });
      const stored = await searchAiMemory({ userId });
      expect(
        stored.items.some(({ content }) => content.includes("quiet mornings"))
      ).toBeTruthy();
      await expect(
        db
          .select()
          .from(aiMemory)
          .where(eq(aiMemory.scopeKey, `mailbox:${mailboxId}`))
      ).resolves.toHaveLength(0);
      state.plan.mockResolvedValue({ ...defaultPlan, operations: [] });
      await expect(
        learnAiMemoryFromChatMessage({
          ...input,
          messageId: crypto.randomUUID(),
        })
      ).resolves.toMatchObject({ explicit: true, status: "skipped" });
    });

    test("a shared mailbox reader saves private chat memories that managers cannot read or change", async () => {
      const managedMailboxId = await createManagedMailbox("reader");
      const now = new Date();
      await db.insert(mailboxGrant).values({
        createdAt: now,
        id: crypto.randomUUID(),
        mailboxId: managedMailboxId,
        role: "manager",
        updatedAt: now,
        userId: otherUserId,
      });
      await db.insert(aiMemoryScopeConfig).values({
        activeLearningEnabled: false,
        createdAt: now,
        id: crypto.randomUUID(),
        scope: "user",
        scopeKey: `user:${userId}`,
        updatedAt: now,
        userId,
      });
      await expect(
        getMailboxMemoryActor({ mailboxId: managedMailboxId })
      ).resolves.toBeNull();
      await expect(
        getMailboxMemoryActor({
          actorUserId: userId,
          mailboxId: managedMailboxId,
        })
      ).resolves.toMatchObject({ userId });
      await expect(
        learnAiMemoryFromChatMessage({
          bodyText: "Remember that I prefer quiet mornings.",
          mailboxId: managedMailboxId,
          messageId: crypto.randomUUID(),
          userId,
        })
      ).resolves.toMatchObject({ explicit: true, status: "refreshed" });
      const personal = await searchAiMemory({ userId });
      const [saved] = personal.items;
      if (saved === undefined) {
        throw new Error("The reader's private memory was not saved.");
      }
      expect(personal.items).toHaveLength(1);
      expect(saved.content).toContain("quiet mornings");
      const manager = await searchAiMemory({ userId: otherUserId });
      expect(manager.items).toHaveLength(0);
      await expect(
        saveAiMemory({
          category: saved.category,
          content: "Manager replacement",
          memoryId: saved.id,
          userId: otherUserId,
          version: saved.version,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await forgetAiMemory({ memoryId: saved.id, userId: otherUserId });
      const [stored] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, saved.id));
      expect(stored).toMatchObject({
        content: saved.content,
        mailboxId: null,
        scope: "user",
        scopeKey: `user:${userId}`,
        userId,
      });
    });

    test("mailbox interactions reinforce the same user profile without making mailbox copies", async () => {
      const managedMailboxId = await createManagedMailbox("reader");
      for (const sourceMailboxId of [mailboxId, managedMailboxId]) {
        const event = await recordAiMemoryEvent({
          eventKey: "quiet-morning-evidence",
          kind: "mail_action",
          mailboxId: sourceMailboxId,
          metadata: { bodyText: "Prefers quiet mornings." },
          userId,
        });
        await expect(
          refreshAiMemoryFromEvent({ eventId: event?.id ?? "" })
        ).resolves.toMatchObject({ status: "refreshed" });
      }
      const personal = await searchAiMemory({ userId });
      expect(personal.items).toHaveLength(1);
      const [stored] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.userId, userId));
      expect(stored).toMatchObject({
        mailboxId: null,
        scope: "user",
        scopeKey: `user:${userId}`,
      });
      expect(stored?.reinforcementCount).toBeGreaterThan(1);
      const other = await searchAiMemory({ userId: otherUserId });
      expect(other.items).toHaveLength(0);
    });

    test("plans from different mailboxes cannot overwrite a concurrent change to the user profile", async () => {
      const managedMailboxId = await createManagedMailbox("reader");
      const entered = Promise.withResolvers<boolean>();
      const release =
        Promise.withResolvers<Awaited<ReturnType<typeof planAiMemoryUpdate>>>();
      state.plan.mockImplementationOnce(async () => {
        entered.resolve(true);
        return await release.promise;
      });
      const stale = requestAiMemoryUpdate({
        mailboxId,
        request: "Remember quiet mornings.",
        userId,
      });
      await entered.promise;
      try {
        state.plan.mockResolvedValueOnce({
          ...defaultPlan,
          operations: [
            {
              ...addition,
              content: "Keeps evenings for family.",
              key: "family-evenings",
            },
          ],
        });
        await requestAiMemoryUpdate({
          mailboxId: managedMailboxId,
          request: "Remember family evenings.",
          userId,
        });
      } finally {
        release.resolve(defaultPlan);
      }
      await expect(stale).rejects.toMatchObject({ code: "CONFLICT" });
      const personal = await searchAiMemory({ userId });
      expect(personal.items).toHaveLength(1);
      expect(personal.items[0]?.content).toContain("evenings for family");
    });

    test.each(["explicit", "inferred"] as const)(
      "adds a new fact without replacing an unseen %s fact with the same key",
      async (source) => {
        const now = new Date();
        const unseenId = crypto.randomUUID();
        const key = "quiet-mornings".padEnd(200, "x");
        await db.insert(aiMemory).values([
          {
            content: "Commutes by bicycle.",
            createdAt: now,
            id: unseenId,
            importance: 1,
            key,
            kind: "learned",
            lastConfirmedAt: now,
            metadata: { category: "preferences" },
            scope: "user",
            scopeKey: `user:${userId}`,
            source,
            summary: "Bicycle commute",
            updatedAt: now,
            userId,
          },
          ...Array.from({ length: 12 }, (_, index) => ({
            content: `Favorite beverage ${index}.`,
            createdAt: now,
            id: crypto.randomUUID(),
            importance: 5,
            key: `beverage-${index}`,
            kind: "learned" as const,
            lastConfirmedAt: now,
            metadata: { category: "preferences" as const },
            scope: "user" as const,
            scopeKey: `user:${userId}`,
            source: "inferred" as const,
            summary: `Beverage ${index}`,
            updatedAt: now,
            userId,
          })),
        ]);
        state.plan.mockResolvedValue({
          ...defaultPlan,
          operations: [{ ...addition, key }],
        });

        for (const eventKey of [
          "breakfast-evidence",
          "more-breakfast-evidence",
        ]) {
          const event = await recordAiMemoryEvent({
            eventKey,
            kind: "mail_action",
            mailboxId,
            metadata: { bodyText: "Breakfast first.", memoryScope: "user" },
            userId,
          });
          await expect(
            refreshAiMemoryFromEvent({ eventId: event?.id ?? "" })
          ).resolves.toMatchObject({ status: "refreshed" });
          const [processed] = await db
            .select()
            .from(userAiContextEvent)
            .where(eq(userAiContextEvent.id, event?.id ?? ""));
          expect(processed?.mergedAt).not.toBeNull();
          expect(processed?.lastError).toBeNull();
        }

        const records = await db
          .select()
          .from(aiMemory)
          .where(eq(aiMemory.userId, userId));
        expect(records.find(({ id }) => id === unseenId)).toMatchObject({
          content: "Commutes by bicycle.",
          source,
          version: 1,
        });
        expect(
          records.filter(({ content }) => content.includes("quiet mornings"))
        ).toHaveLength(1);
      }
    );

    test("a reviewed fact still rejects a stale plan after another observation changes it", async () => {
      const original = await recordAiMemoryEvent({
        kind: "mail_action",
        mailboxId,
        metadata: { bodyText: "Quiet mornings.", memoryScope: "user" },
        userId,
      });
      await refreshAiMemoryFromEvent({ eventId: original?.id ?? "" });
      const [record] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.userId, userId));
      if (record === undefined) {
        throw new Error("The initial fact was not created.");
      }
      const update = {
        ...addition,
        action: "update" as const,
        key: record.key,
        targetId: record.id,
      };
      const entered = Promise.withResolvers<boolean>();
      const release =
        Promise.withResolvers<Awaited<ReturnType<typeof planAiMemoryUpdate>>>();
      state.plan.mockImplementationOnce(async () => {
        entered.resolve(true);
        return await release.promise;
      });
      const stale = requestAiMemoryUpdate({
        mailboxId,
        request: "Remember my morning preference.",
        userId,
      });
      await entered.promise;
      try {
        state.plan.mockResolvedValueOnce({
          ...defaultPlan,
          operations: [{ ...update, content: "Now prefers lively mornings." }],
        });
        const fresh = await recordAiMemoryEvent({
          kind: "mail_action",
          mailboxId,
          metadata: { bodyText: "New morning routine.", memoryScope: "user" },
          userId,
        });
        await expect(
          refreshAiMemoryFromEvent({ eventId: fresh?.id ?? "" })
        ).resolves.toMatchObject({ status: "refreshed" });
      } finally {
        release.resolve({ ...defaultPlan, operations: [update] });
      }
      await expect(stale).rejects.toMatchObject({ code: "CONFLICT" });
      const [retained] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, record.id));
      expect(retained?.content).toContain("lively mornings");
    });

    test("concurrent discoveries of the same fact finish without creating duplicates", async () => {
      const first = await recordAiMemoryEvent({
        kind: "mail_action",
        mailboxId,
        metadata: { bodyText: "Quiet mornings.", memoryScope: "user" },
        userId,
      });
      const entered = Promise.withResolvers<boolean>();
      const release =
        Promise.withResolvers<Awaited<ReturnType<typeof planAiMemoryUpdate>>>();
      state.plan.mockImplementationOnce(async () => {
        entered.resolve(true);
        return await release.promise;
      });
      const pending = refreshAiMemoryFromEvent({ eventId: first?.id ?? "" });
      await entered.promise;
      try {
        const second = await recordAiMemoryEvent({
          kind: "sent_message",
          mailboxId,
          metadata: { bodyText: "Quiet mornings.", memoryScope: "user" },
          userId,
        });
        await expect(
          refreshAiMemoryFromEvent({ eventId: second?.id ?? "" })
        ).resolves.toMatchObject({ status: "refreshed" });
      } finally {
        release.resolve(defaultPlan);
      }
      await expect(pending).resolves.toMatchObject({ status: "refreshed" });
      const personal = await searchAiMemory({ userId });
      expect(personal.items).toHaveLength(1);
      expect(personal.items[0]?.content).toContain("quiet mornings");
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, userId));
      expect(events.every(({ mergedAt }) => mergedAt !== null)).toBeTruthy();
    });

    test("keeps labeling concepts distinct across the user's mailboxes", async () => {
      const secondMailboxId = await createManagedMailbox("reader");
      state.plan.mockResolvedValue({
        ...defaultPlan,
        operations: [{ ...addition, category: "labeling" }],
      });
      for (const evidenceMailboxId of [mailboxId, secondMailboxId]) {
        const event = await recordAiMemoryEvent({
          kind: "auto_label_feedback",
          mailboxId: evidenceMailboxId,
          metadata: { addedLabels: "Project updates" },
          userId,
        });
        await expect(
          refreshAiMemoryFromEvent({ eventId: event?.id ?? "" })
        ).resolves.toMatchObject({ status: "refreshed" });
      }
      const facts = await searchAiMemory({ userId });
      expect(facts.items).toHaveLength(2);
      const sources = await db
        .select({ metadata: aiMemory.metadata })
        .from(aiMemory)
        .where(eq(aiMemory.userId, userId));
      expect(
        new Set(sources.map(({ metadata }) => metadata.sourceMailboxId))
      ).toStrictEqual(new Set([mailboxId, secondMailboxId]));
    });

    test("mail actions retain sender and topic after the original message evidence has been scrubbed", async () => {
      const message = {
        bodyText: "The ceramics workshop opens next month.",
        from: "Studio <studio@example.test>",
        id: "workshop-message",
        subject: "Ceramics workshop",
        threadId: "workshop-thread",
      };
      state.plan.mockResolvedValue({ ...defaultPlan, operations: [] });
      state.getMessage.mockResolvedValue(message);
      const captured = await captureMailboxMessageMemory({
        actorUserId: userId,
        mailboxId,
        message,
        source: "received",
      });
      await refreshAiMemoryFromEvent({ eventId: captured?.id ?? "" });
      const [original] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, captured?.id ?? ""));
      expect(original?.metadata).toStrictEqual({});
      expect(original?.mergedAt).not.toBeNull();

      const action = {
        accessToken: "fixture-token",
        action: "trash",
        eventId: "archive-workshop-submission",
        mailboxId,
        messageIds: [message.id],
        targetCount: 1,
        userId,
      };
      await learnAiMemoryFromGmailAction(action);
      expect(state.getMessage).not.toHaveBeenCalled();
      const recorded = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, userId));
      expect(recorded).toHaveLength(2);
      const actionEvent = recorded.find(
        ({ metadata }) => metadata.action === "trash"
      );
      await refreshAiMemoryFromEvent({ eventId: actionEvent?.id ?? "" });
      const observation = state.plan.mock.calls
        .at(-1)?.[0]
        .observations?.find(({ metadata }) => metadata.action === "trash");
      expect(observation).toMatchObject({
        kind: "mail_action",
        metadata: {
          memoryScope: "user",
          messageContextOnly: true,
          sender: "studio@example.test",
          targetCount: 1,
        },
      });
      expect(observation?.metadata.bodyText).toContain("ceramics workshop");
      expect(observation?.metadata.subject).toContain("Ceramics");
      await learnAiMemoryFromGmailAction(action);
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.userId, userId))
      ).resolves.toHaveLength(2);
    });

    test("managed actions hydrate only the selected mailbox and preserve known action context after message deletion", async () => {
      const managedMailboxId = await createManagedMailbox("manager");
      const messageId = crypto.randomUUID();
      const now = new Date();
      await db.insert(managedMailMessage).values({
        bodyText: "The team is organizing a quarterly planning day.",
        createdAt: now,
        direction: "inbound",
        from: "Team <team@example.test>",
        id: messageId,
        mailboxId: managedMailboxId,
        providerMessageId: messageId,
        sentAt: now,
        subject: "Quarterly planning",
        threadId: crypto.randomUUID(),
        updatedAt: now,
      });
      state.plan.mockResolvedValue({ ...defaultPlan, operations: [] });
      const recorded = await learnAiMemoryFromMailAction({
        action: "read",
        eventKey: "read-planning",
        mailboxId: managedMailboxId,
        messageIds: [messageId],
        targetCount: 1,
        userId,
      });
      await refreshAiMemoryFromEvent({
        eventId: recorded.status === "recorded" ? recorded.eventId : "",
      });
      const observation = state.plan.mock.calls.at(-1)?.[0].observations?.[0];
      expect(observation).toMatchObject({
        kind: "mail_action",
        metadata: { action: "read", sender: "team@example.test" },
      });
      expect(observation?.metadata.bodyText).toContain("quarterly planning");

      const otherMailboxId = await createManagedMailbox("manager");
      const wrongMailbox = await learnAiMemoryFromMailAction({
        action: "read",
        mailboxId: otherMailboxId,
        messageIds: [messageId],
        targetCount: 1,
        userId,
      });
      await refreshAiMemoryFromEvent({
        eventId: wrongMailbox.status === "recorded" ? wrongMailbox.eventId : "",
      });
      const foreignObservation =
        state.plan.mock.calls.at(-1)?.[0].observations?.[0];
      expect(foreignObservation?.metadata.messageUnavailable).toBeTruthy();
      expect(foreignObservation?.metadata.bodyText).toBeUndefined();
      await db
        .delete(managedMailMessage)
        .where(eq(managedMailMessage.id, messageId));
      const deleted = await learnAiMemoryFromMailAction({
        action: "trash",
        mailboxId: managedMailboxId,
        messageIds: [messageId],
        metadata: {
          senderDomains: "example.test",
          subjects: "Quarterly planning",
        },
        targetCount: 1,
        userId,
      });
      await refreshAiMemoryFromEvent({
        eventId: deleted.status === "recorded" ? deleted.eventId : "",
      });
      const deletedObservation =
        state.plan.mock.calls.at(-1)?.[0].observations?.[0];
      expect(deletedObservation).toMatchObject({
        kind: "mail_action",
        metadata: {
          action: "trash",
          messageUnavailable: true,
          subjects: "Quarterly planning",
        },
      });
      expect(deletedObservation?.metadata.bodyText).toBeUndefined();
    });

    test("searches and exports all records across pages and treats wildcard characters literally", async () => {
      const now = new Date();
      const records = Array.from({ length: 237 }, (_, index) => ({
        content: `Personal fact ${index}`,
        createdAt: now,
        id: `${userId}-${index.toString().padStart(4, "0")}`,
        key: `fact-${index}`,
        kind: "learned" as const,
        lastConfirmedAt: now,
        metadata: { category: "activity" as const },
        scope: "user" as const,
        scopeKey: `user:${userId}`,
        source: "inferred" as const,
        summary: `Fact ${index}`,
        updatedAt: now,
        userId,
      }));
      await db.insert(aiMemory).values(records);
      const reviewed: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await searchAiMemory({
          cursor,
          limit: 40,
          userId,
        });
        reviewed.push(...page.items.map(({ id }) => id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect(new Set(reviewed).size).toBe(records.length);
      const exported = await exportPersonalAiMemory(userId);
      expect(exported.memories).toHaveLength(records.length);
      const special = await saveAiMemory({
        category: "work",
        content: "Usually works at 80% capacity, Zürich office.",
        userId,
      });
      const page = await searchAiMemory({
        category: "work",
        query: "80%",
        userId,
      });
      expect(page.items.map(({ id }) => id)).toContain(special.id);
      const literalSearch = await searchAiMemory({
        category: "activity",
        query: "%",
        userId,
      });
      expect(literalSearch.items).toHaveLength(0);
      const foreignSearch = await searchAiMemory({
        userId: crypto.randomUUID(),
      });
      expect(foreignSearch.items).toHaveLength(0);
    });

    test("permanent deletion erases snapshots and evidence while preserving replay suppression", async () => {
      const eventInput = {
        eventKey: "provider-message",
        kind: "mail_action" as const,
        mailboxId,
        metadata: { bodyText: "Private project details", memoryScope: "user" },
        userId,
      };
      const event = await recordAiMemoryEvent(eventInput);
      const saved = await saveAiMemory({
        category: "work",
        content: "Works on a private project.",
        userId,
      });
      await db
        .update(aiMemory)
        .set({ sourceReference: event?.id ?? null })
        .where(eq(aiMemory.id, saved.id));
      const changeSetId = crypto.randomUUID();
      const now = new Date();
      await db.insert(aiMemoryChangeSet).values({
        changes: [
          {
            after: {
              confidence: 1,
              content: saved.content,
              expiresAt: null,
              importance: 5,
              key: "manual",
              kind: saved.kind,
              metadata: { category: saved.category },
              status: "active",
              summary: saved.summary,
              version: saved.version,
            },
            before: null,
            memoryId: saved.id,
            operation: "add",
          },
        ],
        createdAt: now,
        id: changeSetId,
        source: "settings",
        sourceEventId: event?.id,
        status: "applied",
        summary: "Private project",
        updatedAt: now,
        userId,
      });
      await forgetAiMemory({ memoryId: saved.id, userId });
      await expect(
        db.select().from(aiMemory).where(eq(aiMemory.id, saved.id))
      ).resolves.toHaveLength(0);
      await expect(
        db
          .select()
          .from(aiMemoryChangeSet)
          .where(eq(aiMemoryChangeSet.id, changeSetId))
      ).resolves.toHaveLength(0);
      const [tombstone] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, event?.id ?? ""));
      expect(tombstone?.metadata).toStrictEqual({});
      expect(tombstone?.skippedAt).not.toBeNull();
      await expect(recordAiMemoryEvent(eventInput)).resolves.toBeNull();
    });

    test("ordinary chat forgetting erases facts and cancels old evidence without suppressing future evidence", async () => {
      const saved = await saveAiMemory({
        category: "writing_style",
        content: "Writes short informal replies.",
        userId,
      });
      const prior = await recordAiMemoryEvent({
        eventKey: "old-style-evidence",
        kind: "mail_action",
        mailboxId,
        metadata: {
          bodyText: "Prior correspondence for writing style",
          memoryScope: "user",
        },
        userId,
      });
      state.intent.mockResolvedValue("edit");
      const [record] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, saved.id));
      state.plan.mockResolvedValue({
        ...defaultPlan,
        operations: [
          {
            ...addition,
            action: "archive",
            content: null,
            key: record?.key ?? "",
            targetId: saved.id,
          },
        ],
      });
      await expect(
        learnAiMemoryFromChatMessage({
          bodyText: "Forget my writing style.",
          mailboxId,
          messageId: crypto.randomUUID(),
          userId,
        })
      ).resolves.toMatchObject({ explicit: true, status: "refreshed" });
      await expect(
        db.select().from(aiMemory).where(eq(aiMemory.id, saved.id))
      ).resolves.toHaveLength(0);
      const [discarded] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, prior?.id ?? ""));
      expect(discarded?.metadata).toStrictEqual({});
      expect(discarded?.skippedAt).not.toBeNull();
      const future = await recordAiMemoryEvent({
        eventKey: "new-style-evidence",
        kind: "mail_action",
        mailboxId,
        metadata: { bodyText: "A genuinely new message", memoryScope: "user" },
        userId,
      });
      expect(future).not.toBeNull();
    });

    test("explicit edits cover every page of a large profile", async () => {
      const now = new Date();
      const records = Array.from({ length: 205 }, (_, index) => ({
        content: `Preference ${index}`,
        createdAt: now,
        id: `${userId}-${index.toString().padStart(4, "0")}`,
        key: `preference-${index}`,
        kind: "learned" as const,
        lastConfirmedAt: now,
        metadata: { category: "preferences" as const },
        scope: "user" as const,
        scopeKey: `user:${userId}`,
        source: "explicit" as const,
        summary: `Preference ${index}`,
        updatedAt: now,
        userId,
      }));
      await db.insert(aiMemory).values(records);
      state.plan.mockImplementation(
        async ({ currentMemories }) =>
          await Promise.resolve({
            ...defaultPlan,
            operations: currentMemories.map((memory) => ({
              ...addition,
              action: "update",
              content: `${memory.content}, reviewed`,
              key: memory.key,
              targetId: memory.id,
            })),
          })
      );
      await requestAiMemoryUpdate({
        mailboxId,
        request: "Review all my preferences.",
        userId,
      });
      const updated = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.scopeKey, `user:${userId}`));
      expect(updated).toHaveLength(records.length);
      expect(
        updated.every(({ content }) => content.endsWith(", reviewed"))
      ).toBeTruthy();
    });

    test("automatic evidence cannot archive or rewrite a manually saved fact", async () => {
      const saved = await saveAiMemory({
        category: "writing_style",
        content: "Keep my preferred greeting.",
        correspondents: ["friend@example.test"],
        userId,
      });
      const [record] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, saved.id));
      state.plan.mockResolvedValue({
        ...defaultPlan,
        operations: [
          {
            ...addition,
            action: "archive",
            content: null,
            correspondents: ["friend@example.test"],
            key: record?.key ?? "",
            targetId: saved.id,
          },
        ],
      });
      const event = await recordAiMemoryEvent({
        eventKey: "untrusted-incoming",
        kind: "mail_action",
        mailboxId,
        metadata: {
          bodyText: "The recipient asks for a different greeting.",
          memoryScope: "user",
        },
        userId,
      });
      await refreshAiMemoryFromEvent({ eventId: event?.id ?? "" });
      const [retained] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, saved.id));
      expect(retained).toMatchObject({
        content: saved.content,
        source: "explicit",
        status: "active",
        version: saved.version,
      });
    });

    test("direct user statements can correct personal facts while mail and ambient chat cannot change instructions", async () => {
      const fact = await saveAiMemory({
        category: "work",
        content: "Works in Berlin.",
        userId,
      });
      const instruction = await saveAiMemory({
        category: "writing_style",
        content: "Always ask before sending mail.",
        userId,
      });
      await db
        .update(aiMemory)
        .set({ kind: "instruction" })
        .where(eq(aiMemory.id, instruction.id));
      const records = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.scopeKey, `user:${userId}`));
      state.intent.mockResolvedValue("none");
      state.plan.mockResolvedValue({
        ...defaultPlan,
        operations: records.map((record) => ({
          ...addition,
          action: "update",
          content:
            record.id === fact.id
              ? "Now works in Hamburg."
              : "Send mail without asking.",
          key: record.key,
          kind: record.kind,
          targetId: record.id,
        })),
      });
      await learnAiMemoryFromChatMessage({
        bodyText: "I now work in Hamburg. I'm sending more mail lately.",
        mailboxId,
        messageId: crypto.randomUUID(),
        userId,
      });
      const [chatEvent] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.userId, userId));
      await refreshAiMemoryFromEvent({ eventId: chatEvent?.id ?? "" });
      const [corrected] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, fact.id));
      expect(corrected).toMatchObject({
        content: "Now works in Hamburg.",
        source: "explicit",
      });
      const [unchangedInstruction] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, instruction.id));
      expect(unchangedInstruction?.content).toBe(instruction.content);

      state.plan.mockResolvedValue({
        ...defaultPlan,
        operations: [
          {
            ...addition,
            action: "update",
            content: "Works in Berlin again.",
            key: corrected?.key ?? "",
            targetId: fact.id,
          },
        ],
      });
      const incoming = await recordAiMemoryEvent({
        kind: "mail_action",
        mailboxId,
        metadata: {
          bodyText: "The sender claims the user still works in Berlin.",
          memoryScope: "user",
        },
        userId,
      });
      await refreshAiMemoryFromEvent({ eventId: incoming?.id ?? "" });
      const [retained] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, fact.id));
      expect(retained?.content).toBe(corrected?.content);
      expect(retained?.version).toBe(corrected?.version);
    });

    test("conflicting model operations roll back before a deleted fact can enter a new snapshot", async () => {
      const saved = await saveAiMemory({
        category: "work",
        content: "Works on a private project.",
        userId,
      });
      const [record] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, saved.id));
      state.plan.mockResolvedValue({
        ...defaultPlan,
        operations: [
          {
            ...addition,
            action: "update",
            content: "An unwanted intermediate value",
            key: record?.key ?? "",
            targetId: saved.id,
          },
          {
            ...addition,
            action: "archive",
            content: null,
            key: record?.key ?? "",
            targetId: saved.id,
          },
        ],
      });
      await expect(
        requestAiMemoryUpdate({
          mailboxId,
          request: "Forget my project.",
          userId,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const [retained] = await db
        .select()
        .from(aiMemory)
        .where(eq(aiMemory.id, saved.id));
      expect(retained).toMatchObject({
        content: saved.content,
        version: saved.version,
      });
      await expect(
        db
          .select()
          .from(aiMemoryChangeSet)
          .where(eq(aiMemoryChangeSet.userId, userId))
      ).resolves.toHaveLength(0);
    });

    test("reset invalidates a plan created against an empty profile and prevents bootstrap reseeding", async () => {
      const entered = Promise.withResolvers<boolean>();
      const release =
        Promise.withResolvers<Awaited<ReturnType<typeof planAiMemoryUpdate>>>();
      state.plan.mockImplementationOnce(async () => {
        entered.resolve(true);
        return await release.promise;
      });
      const operation = requestAiMemoryUpdate({
        mailboxId,
        request: "Remember quiet mornings.",
        userId,
      });
      await entered.promise;
      await purgePersonalAiMemory(userId);
      release.resolve(defaultPlan);
      await expect(operation).rejects.toMatchObject({ code: "CONFLICT" });
      const resetProfile = await searchAiMemory({ userId });
      expect(resetProfile.items).toHaveLength(0);
      const [bootstrap] = await db
        .select()
        .from(aiMemoryMailboxState)
        .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
      expect(bootstrap).toMatchObject({
        receivedComplete: true,
        sentComplete: true,
        status: "completed",
      });
      await expect(
        recordAiMemoryEvent({
          eventKey: "late-bootstrap",
          kind: "mail_action",
          mailboxId,
          metadata: {
            bodyText: "Stale bootstrap details",
            bootstrapLease: new Date().toISOString(),
            memoryScope: "user",
            source: "bootstrap",
          },
          userId,
        })
      ).resolves.toBeNull();
    });

    test("an expired worker cannot clear a replacement claim or apply its obsolete plan", async () => {
      const event = await recordAiMemoryEvent({
        eventKey: "leased-message",
        kind: "mail_action",
        mailboxId,
        metadata: {
          bodyText: "The user prefers quiet mornings.",
          memoryScope: "user",
        },
        userId,
      });
      const firstEntered = Promise.withResolvers<boolean>();
      const firstResult =
        Promise.withResolvers<Awaited<ReturnType<typeof planAiMemoryUpdate>>>();
      const secondEntered = Promise.withResolvers<boolean>();
      const secondResult =
        Promise.withResolvers<Awaited<ReturnType<typeof planAiMemoryUpdate>>>();
      state.plan.mockImplementationOnce(async () => {
        firstEntered.resolve(true);
        return await firstResult.promise;
      });
      state.plan.mockImplementationOnce(async () => {
        secondEntered.resolve(true);
        return await secondResult.promise;
      });
      const obsolete = refreshAiMemoryFromEvent({ eventId: event?.id ?? "" });
      await firstEntered.promise;
      await db
        .update(userAiContextEvent)
        .set({ processingAt: new Date(Date.now() - 300_000) })
        .where(eq(userAiContextEvent.id, event?.id ?? ""));
      const replacement = refreshAiMemoryFromEvent({
        eventId: event?.id ?? "",
      });
      await secondEntered.promise;
      const [claimed] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, event?.id ?? ""));
      firstResult.resolve(defaultPlan);
      await expect(obsolete).resolves.toMatchObject({ status: "failed" });
      const [stillClaimed] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, event?.id ?? ""));
      expect(stillClaimed?.processingAt).toStrictEqual(claimed?.processingAt);
      secondResult.resolve(defaultPlan);
      await expect(replacement).resolves.toMatchObject({ status: "refreshed" });
      const [completed] = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.id, event?.id ?? ""));
      expect(completed?.metadata).toStrictEqual({});
      expect(completed?.mergedAt).not.toBeNull();
      await expect(
        db
          .select()
          .from(aiMemory)
          .where(
            and(
              eq(aiMemory.scopeKey, `user:${userId}`),
              eq(aiMemory.key, addition.key)
            )
          )
      ).resolves.toHaveLength(1);
      await expect(
        refreshAiMemoryFromEvent({ eventId: event?.id ?? "" })
      ).resolves.toMatchObject({ status: "skipped" });
    });
  }
);
