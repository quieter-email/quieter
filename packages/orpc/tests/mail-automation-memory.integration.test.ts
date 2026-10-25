import { db } from "@quieter/database/client";
import {
  aiMemory as memoryRecord,
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
