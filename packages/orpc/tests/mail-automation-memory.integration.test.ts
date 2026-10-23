import { db } from "@quieter/database/client";
import {
  gmailLabel,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import type { getMessageWithDetails } from "@quieter/gmail";
import { eq, inArray } from "drizzle-orm";
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
  loadMailAutoLabelSenderHistory,
  recordMailAutoLabelFeedback,
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
      vi.spyOn(
        aiMemory,
        "replaceMailboxFeedbackMemories"
      ).mockRejectedValueOnce(
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

    test.each([
      {
        erase: async (memoryId: string) =>
          await aiMemory.forgetAiMemory({
            mailboxId,
            memoryId,
            scope: "mailbox",
            userId,
          }),
        operation: "delete",
      },
      {
        erase: async (_memoryId: string) =>
          await aiMemory.purgeMailboxAiMemory(mailboxId),
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
          mailboxId,
          scope: "mailbox",
          userId,
        });
        expect(saved.items).toHaveLength(1);

        const entered = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const replace = aiMemory.replaceMailboxFeedbackMemories;
        vi.spyOn(
          aiMemory,
          "replaceMailboxFeedbackMemories"
        ).mockImplementationOnce(async (input) => {
          entered.resolve(true);
          await release.promise;
          return await replace(input);
        });
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
      await expect(
        loadMailAutoLabelSenderHistory({ from: message.from, mailboxId })
      ).resolves.toBeNull();
    });
  }
);
