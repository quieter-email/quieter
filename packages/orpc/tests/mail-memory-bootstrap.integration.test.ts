import { db } from "@quieter/database/client";
import {
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  mailbox,
  member,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import type {
  getMessageWithDetails,
  listGmailMessageIds,
} from "@quieter/gmail";
import { eq, inArray } from "drizzle-orm";
/* oxlint-disable eslint/require-await -- Provider mocks resolve synthetic records without network I/O. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { purgePersonalAiMemory } from "../src/ai-memory";
import {
  getMailboxMemoryBootstrap,
  listMailboxMemoryBootstraps,
  processPendingMailMemoryBootstrap,
  queueMailboxMemoryBootstrap,
  retryMailboxMemoryBootstrap,
} from "../src/ai-memory-capture";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  getMessage: vi.fn<typeof getMessageWithDetails>(),
  listMessages: vi.fn<typeof listGmailMessageIds>(),
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
  listGmailMessageIds: state.listMessages,
}));
vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <TValue>(
    _input: { mailboxId: string; userId: string },
    request: (accessToken: string) => Promise<TValue>
  ): Promise<TValue> => await request("fixture-token"),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "recent-mail learning on PostgreSQL",
  () => {
    const userId = crypto.randomUUID();
    const pausedUserId = crypto.randomUUID();
    const newOwnerUserId = crypto.randomUUID();
    const formerMemberUserId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const received = Array.from(
      { length: 13 },
      (_, index) => `received-${index}`
    );
    const sent = Array.from({ length: 7 }, (_, index) => `sent-${index}`);

    const createMailbox = async ({
      ownerId = userId,
      provider = "gmail",
    }: {
      ownerId?: string | null;
      provider?: "gmail" | "managed";
    } = {}) => {
      const mailboxId = crypto.randomUUID();
      const now = new Date();
      await db.insert(mailbox).values({
        accessMode: ownerId === null ? "shared" : "private",
        createdAt: now,
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        managedOwnerUserId: provider === "managed" ? ownerId : null,
        organizationId,
        ownerUserId: provider === "gmail" ? ownerId : null,
        provider,
        status: "connected",
        updatedAt: now,
      });
      return mailboxId;
    };

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Recent mail integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values(
        [userId, pausedUserId, newOwnerUserId, formerMemberUserId].map(
          (id) => ({
            createdAt: now,
            email: `${id}@example.test`,
            emailVerified: true,
            id,
            name: "Mail learning fixture",
            updatedAt: now,
          })
        )
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Mail learning fixture",
        slug: organizationId,
      });
      await db.insert(member).values(
        [userId, pausedUserId, newOwnerUserId].map((id) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          organizationId,
          role: "member",
          userId: id,
        }))
      );
    });

    beforeEach(() => {
      state.listMessages
        .mockReset()
        .mockImplementation(async (_token, options) => {
          const messages =
            options?.query?.startsWith("in:sent") === true ? sent : received;
          const offset = Number(options?.pageToken ?? 0);
          const nextOffset = offset + (options?.maxResults ?? messages.length);
          return {
            messageIds: messages.slice(offset, nextOffset),
            nextPageToken:
              nextOffset < messages.length ? String(nextOffset) : undefined,
          };
        });
      state.getMessage
        .mockReset()
        .mockImplementation(async (_token, messageId) => ({
          bodyText: "Please send the revised launch plan tomorrow.",
          from: messageId.startsWith("sent-")
            ? "owner@example.test"
            : "colleague@example.test",
          id: messageId,
          labelIds: messageId.startsWith("sent-") ? ["SENT"] : ["INBOX"],
          subject: "Launch plan",
          threadId: messageId,
          to: "owner@example.test",
        }));
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db
        .delete(user)
        .where(
          inArray(user.id, [
            userId,
            pausedUserId,
            newOwnerUserId,
            formerMemberUserId,
          ])
        );
      await db.$client.end();
    });

    test("only enabled owners with current access can start recent-mail learning", async () => {
      const now = new Date();
      await db.insert(aiMemoryScopeConfig).values({
        activeLearningEnabled: false,
        createdAt: now,
        id: crypto.randomUUID(),
        scope: "user",
        scopeKey: `user:${pausedUserId}`,
        updatedAt: now,
        userId: pausedUserId,
      });
      const pausedGmail = await createMailbox({ ownerId: pausedUserId });
      const pausedManaged = await createMailbox({
        ownerId: pausedUserId,
        provider: "managed",
      });
      const inaccessibleManaged = await createMailbox({
        ownerId: formerMemberUserId,
        provider: "managed",
      });
      const sharedManaged = await createMailbox({
        ownerId: null,
        provider: "managed",
      });
      const enabledGmail = await createMailbox();
      const enabledManaged = await createMailbox({ provider: "managed" });
      state.listMessages.mockResolvedValue({ messageIds: [] });

      await expect(
        listMailboxMemoryBootstraps(formerMemberUserId)
      ).resolves.toHaveLength(0);

      await processPendingMailMemoryBootstrap({ userId: pausedUserId });
      await processPendingMailMemoryBootstrap({ userId: formerMemberUserId });
      await processPendingMailMemoryBootstrap({ userId });

      await expect(
        getMailboxMemoryBootstrap({ mailboxId: enabledGmail, userId })
      ).resolves.toMatchObject({ status: "completed" });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId: enabledManaged, userId })
      ).resolves.toMatchObject({ status: "completed" });
      const ignored = await db
        .select()
        .from(aiMemoryMailboxState)
        .where(
          inArray(aiMemoryMailboxState.mailboxId, [
            pausedGmail,
            pausedManaged,
            inaccessibleManaged,
            sharedManaged,
          ])
        );
      expect(ignored).toHaveLength(0);
    });

    test.each(["completed", "processing"] as const)(
      "transferring a private mailbox renews a %s scan for the new owner",
      async (status) => {
        const mailboxId = await createMailbox({ provider: "managed" });
        await queueMailboxMemoryBootstrap({ mailboxId, userId });
        await db
          .update(aiMemoryMailboxState)
          .set({ processingAt: new Date(), status })
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
        await db
          .update(mailbox)
          .set({ managedOwnerUserId: newOwnerUserId })
          .where(eq(mailbox.id, mailboxId));

        await expect(
          getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
        ).resolves.toMatchObject({ status: "not_started" });
        await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
        await expect(
          getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
        ).resolves.toMatchObject({ status: "completed" });
        const [current] = await db
          .select()
          .from(aiMemoryMailboxState)
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
        expect(current).toMatchObject({
          processingAt: null,
          userId: newOwnerUserId,
        });
      }
    );

    test("retries a partial provider read without skipping either mail direction or duplicating evidence", async () => {
      const mailboxId = await createMailbox();
      await queueMailboxMemoryBootstrap({ mailboxId, userId });
      state.getMessage.mockRejectedValueOnce(
        new Error("Transient fixture failure")
      );
      await expect(
        processPendingMailMemoryBootstrap({ userId })
      ).resolves.toMatchObject({ failed: 1 });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId })
      ).resolves.toMatchObject({ status: "failed" });
      await retryMailboxMemoryBootstrap({ mailboxId, userId });
      for (
        let attempt = 0;
        attempt < received.length + sent.length;
        attempt += 1
      ) {
        await processPendingMailMemoryBootstrap({ userId });
        const progress = await getMailboxMemoryBootstrap({ mailboxId, userId });
        if (progress.status === "completed") {
          break;
        }
      }
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId })
      ).resolves.toMatchObject({
        receivedCount: received.length,
        sentCount: sent.length,
        status: "completed",
      });
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.mailboxId, mailboxId));
      const messageIds = events.map(({ metadata }) => metadata.messageId);
      for (const messageId of [...received, ...sent]) {
        expect(messageIds).toContain(messageId);
      }
      expect(events).toHaveLength(received.length + sent.length);
      expect(
        events.some(
          ({ metadata }) =>
            metadata.observationKind === "sent_message" &&
            metadata.authorship === "observed_outbound" &&
            metadata.userAuthored === null
        )
      ).toBeTruthy();
    });

    test("erasing personal knowledge cancels in-flight learning and completed checkpoints cannot reseed it", async () => {
      const mailboxId = await createMailbox();
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      state.listMessages.mockImplementation(async (_token, options) => ({
        messageIds:
          options?.query?.startsWith("in:sent") === true
            ? []
            : ["held-message"],
      }));
      state.getMessage.mockImplementation(async (_token, messageId) => {
        started.resolve(true);
        await release.promise;
        return {
          bodyText: "A private detail that must be erased.",
          id: messageId,
          labelIds: ["INBOX"],
          threadId: messageId,
        };
      });
      await queueMailboxMemoryBootstrap({ mailboxId, userId });
      const processing = processPendingMailMemoryBootstrap({ userId });
      await started.promise;
      try {
        await purgePersonalAiMemory(userId);
      } finally {
        release.resolve(true);
        await processing;
      }
      await retryMailboxMemoryBootstrap({ mailboxId, userId });
      await processPendingMailMemoryBootstrap({ userId });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId })
      ).resolves.toMatchObject({ status: "completed" });
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.mailboxId, mailboxId));
      expect(events).toHaveLength(0);
      const rows = await db
        .select()
        .from(aiMemoryMailboxState)
        .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
      expect(rows.at(0)?.processingAt).toBeNull();
    });
  }
);
