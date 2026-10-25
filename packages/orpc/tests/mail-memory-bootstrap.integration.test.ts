import { db } from "@quieter/database/client";
import {
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  gmailCredential,
  mailbox,
  managedMailMessage,
  member,
  organization,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import type {
  getMessageWithDetails,
  listGmailMessageIds,
} from "@quieter/gmail";
import type { reportError } from "@quieter/observability";
import { and, eq, inArray, sql } from "drizzle-orm";
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

import {
  forgetAiMemory,
  purgePersonalAiMemory,
  saveAiMemory,
  searchAiMemory,
} from "../src/ai-memory";
import {
  captureMailboxMessageMemory,
  getMailboxMemoryBootstrap,
  listMailboxMemoryBootstraps,
  processPendingMailMemoryBootstrap,
  queueMailboxMessageMemory,
  queueMailboxMemoryBootstrap,
  retryMailboxMemoryBootstrap,
} from "../src/ai-memory-capture";
import { encryptSecret, GMAIL_SCOPES } from "../src/gmail-mailbox-access";
import * as managedMailboxAccess from "../src/mailbox/access";

const state = vi.hoisted(() => {
  vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY", crypto.randomUUID());
  vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT", crypto.randomUUID());
  return {
    databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
    getMessage: vi.fn<typeof getMessageWithDetails>(),
    listMessages: vi.fn<typeof listGmailMessageIds>(),
    reportError: vi.fn<typeof reportError>(),
  };
});
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
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: state.reportError,
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
      if (provider === "gmail") {
        await db.insert(gmailCredential).values({
          accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
          createdAt: now,
          encryptedAccessToken: encryptSecret("fixture-token"),
          googleSubject: mailboxId,
          mailboxId,
          scopes: GMAIL_SCOPES.join(" "),
          updatedAt: now,
        });
      }
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
      state.reportError.mockReset();
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

    test.each(["pending", "failed", "processing"] as const)(
      "cancels an inaccessible managed %s scan and resumes after membership returns",
      async (status) => {
        const mailboxId = await createMailbox({
          ownerId: newOwnerUserId,
          provider: "managed",
        });
        const neighborId = await createMailbox({ ownerId: newOwnerUserId });
        await queueMailboxMemoryBootstrap({
          mailboxId,
          userId: newOwnerUserId,
        });
        await queueMailboxMemoryBootstrap({
          mailboxId: neighborId,
          userId: newOwnerUserId,
        });
        const expired = new Date(Date.now() - 86_400_000);
        await db
          .update(aiMemoryMailboxState)
          .set({ processingAt: expired, status, updatedAt: expired })
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
        await db
          .delete(member)
          .where(
            and(
              eq(member.organizationId, organizationId),
              eq(member.userId, newOwnerUserId)
            )
          );
        state.listMessages.mockResolvedValue({ messageIds: [] });

        try {
          await expect(
            processPendingMailMemoryBootstrap({ userId: newOwnerUserId })
          ).resolves.toMatchObject({ failed: 0, processed: 1 });
          await expect(
            db
              .select()
              .from(aiMemoryMailboxState)
              .where(eq(aiMemoryMailboxState.mailboxId, mailboxId))
          ).resolves.toHaveLength(0);
          await expect(
            getMailboxMemoryBootstrap({
              mailboxId: neighborId,
              userId: newOwnerUserId,
            })
          ).resolves.toMatchObject({ status: "completed" });
          expect(state.reportError).not.toHaveBeenCalled();
        } finally {
          await db.insert(member).values({
            createdAt: new Date(),
            id: crypto.randomUUID(),
            organizationId,
            role: "member",
            userId: newOwnerUserId,
          });
        }

        await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
        await expect(
          getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
        ).resolves.toMatchObject({ status: "completed" });
      }
    );

    test.each(["pending", "failed", "processing"] as const)(
      "leaves a disconnected %s scan alone so a connected neighbor can run",
      async (status) => {
        const mailboxId = await createMailbox({ ownerId: newOwnerUserId });
        const neighborId = await createMailbox({ ownerId: newOwnerUserId });
        await queueMailboxMemoryBootstrap({
          mailboxId,
          userId: newOwnerUserId,
        });
        await queueMailboxMemoryBootstrap({
          mailboxId: neighborId,
          userId: newOwnerUserId,
        });
        const expired = new Date(Date.now() - 86_400_000);
        await db
          .update(aiMemoryMailboxState)
          .set({ processingAt: expired, status, updatedAt: expired })
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
        await db
          .update(mailbox)
          .set({ status: "needs_reconnect" })
          .where(eq(mailbox.id, mailboxId));
        state.listMessages.mockResolvedValue({ messageIds: [] });

        await expect(
          processPendingMailMemoryBootstrap({
            limit: 1,
            userId: newOwnerUserId,
          })
        ).resolves.toMatchObject({ failed: 0, processed: 1 });
        await expect(
          getMailboxMemoryBootstrap({
            mailboxId: neighborId,
            userId: newOwnerUserId,
          })
        ).resolves.toMatchObject({ status: "completed" });
        await expect(
          db
            .select()
            .from(aiMemoryMailboxState)
            .where(eq(aiMemoryMailboxState.mailboxId, mailboxId))
        ).resolves.toMatchObject([{ processingAt: expired, status }]);
        expect(state.reportError).not.toHaveBeenCalled();

        await db
          .update(mailbox)
          .set({ status: "connected" })
          .where(eq(mailbox.id, mailboxId));
        await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
        await expect(
          getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
        ).resolves.toMatchObject({ status: "completed" });
      }
    );

    test.each(["reconnect", "credential removal"] as const)(
      "cancels a scan when Gmail authorization requires %s between pages",
      async (change) => {
        const mailboxId = await createMailbox({ ownerId: newOwnerUserId });
        await queueMailboxMemoryBootstrap({
          mailboxId,
          userId: newOwnerUserId,
        });
        const credentials = await db
          .select()
          .from(gmailCredential)
          .where(eq(gmailCredential.mailboxId, mailboxId));
        state.listMessages.mockImplementationOnce(async () => {
          if (change === "reconnect") {
            await db
              .update(mailbox)
              .set({ status: "needs_reconnect" })
              .where(eq(mailbox.id, mailboxId));
          } else {
            await db
              .delete(gmailCredential)
              .where(eq(gmailCredential.mailboxId, mailboxId));
          }
          return { messageIds: [] };
        });

        await expect(
          processPendingMailMemoryBootstrap({ userId: newOwnerUserId })
        ).resolves.toMatchObject({ failed: 0, processed: 0 });
        await expect(
          db
            .select()
            .from(aiMemoryMailboxState)
            .where(eq(aiMemoryMailboxState.mailboxId, mailboxId))
        ).resolves.toHaveLength(0);
        expect(state.reportError).not.toHaveBeenCalled();

        await db
          .insert(gmailCredential)
          .values(credentials)
          .onConflictDoNothing();
        await db
          .update(mailbox)
          .set({ status: "connected" })
          .where(eq(mailbox.id, mailboxId));
        state.listMessages.mockResolvedValue({ messageIds: [] });
        await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
        await expect(
          getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
        ).resolves.toMatchObject({ status: "completed" });
      }
    );

    test("continues other scans when membership is lost before a missing scan is queued", async () => {
      const mailboxId = await createMailbox({
        ownerId: newOwnerUserId,
        provider: "managed",
      });
      const neighborId = await createMailbox({ ownerId: newOwnerUserId });
      const authorize = managedMailboxAccess.getAuthorizedManagedMailbox;
      const authorization = vi
        .spyOn(managedMailboxAccess, "getAuthorizedManagedMailbox")
        .mockImplementationOnce(async (input) => {
          await db
            .delete(member)
            .where(
              and(
                eq(member.organizationId, organizationId),
                eq(member.userId, newOwnerUserId)
              )
            );
          return await authorize(input);
        });
      state.listMessages.mockResolvedValue({ messageIds: [] });

      try {
        await expect(
          processPendingMailMemoryBootstrap({ userId: newOwnerUserId })
        ).resolves.toMatchObject({ failed: 0, processed: 1 });
        await expect(
          getMailboxMemoryBootstrap({
            mailboxId: neighborId,
            userId: newOwnerUserId,
          })
        ).resolves.toMatchObject({ status: "completed" });
        expect(state.reportError).not.toHaveBeenCalled();
      } finally {
        authorization.mockRestore();
        await db.insert(member).values({
          createdAt: new Date(),
          id: crypto.randomUUID(),
          organizationId,
          role: "member",
          userId: newOwnerUserId,
        });
      }

      await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
      ).resolves.toMatchObject({ status: "completed" });
    });

    test("an old owner's authorization rejection cannot delete a new owner's lease", async () => {
      const mailboxId = await createMailbox({
        ownerId: newOwnerUserId,
        provider: "managed",
      });
      await queueMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId });
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const authorize = managedMailboxAccess.getAuthorizedManagedMailbox;
      const authorization = vi
        .spyOn(managedMailboxAccess, "getAuthorizedManagedMailbox")
        .mockImplementationOnce(async (input) => {
          started.resolve(true);
          await release.promise;
          return await authorize(input);
        });
      const processing = processPendingMailMemoryBootstrap({
        userId: newOwnerUserId,
      });
      await started.promise;
      try {
        const [previous] = await db
          .select()
          .from(aiMemoryMailboxState)
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
        expect(previous?.processingAt).toBeInstanceOf(Date);
        await db
          .update(mailbox)
          .set({ managedOwnerUserId: userId })
          .where(eq(mailbox.id, mailboxId));
        await queueMailboxMemoryBootstrap({ mailboxId, userId });
        // Ownership must still fence workers whose lease timestamps coincide.
        await db
          .update(aiMemoryMailboxState)
          .set({ processingAt: previous?.processingAt, status: "processing" })
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
      } finally {
        release.resolve(true);
        await processing;
        authorization.mockRestore();
      }
      const current = await db
        .select()
        .from(aiMemoryMailboxState)
        .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
      expect(current).toMatchObject([{ status: "processing", userId }]);
      expect(current.at(0)?.processingAt).toBeInstanceOf(Date);
      expect(state.reportError).not.toHaveBeenCalled();
      await db
        .update(aiMemoryMailboxState)
        .set({ processingAt: null, status: "pending" })
        .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
      await processPendingMailMemoryBootstrap({ userId });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId })
      ).resolves.toMatchObject({ status: "completed" });
    });

    test("retains and reports a provider's missing-resource failure", async () => {
      const mailboxId = await createMailbox({ ownerId: newOwnerUserId });
      await queueMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId });
      state.listMessages.mockRejectedValueOnce(
        Object.assign(new Error("Provider rejected the mailbox read."), {
          status: 404,
        })
      );

      await expect(
        processPendingMailMemoryBootstrap({ userId: newOwnerUserId })
      ).resolves.toMatchObject({ failed: 1, processed: 0 });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
      ).resolves.toMatchObject({ status: "failed" });
      // oxlint-disable-next-line vitest/prefer-called-with -- This regression requires reporting without fixing its diagnostic payload.
      expect(state.reportError).toHaveBeenCalled();

      await retryMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId });
      state.listMessages.mockResolvedValue({ messageIds: [] });
      await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
    });

    test("retains distinct opens and AI reads without duplicating synced mail evidence", async () => {
      const mailboxId = await createMailbox();
      const message = {
        bodyText: "Please review the revised launch plan.",
        from: "colleague@example.test",
        id: "engagement-message",
        threadId: "engagement-thread",
        to: "owner@example.test",
      };
      for (const source of [
        "sync",
        "open",
        "open",
        "ai_read",
        "ai_read",
      ] as const) {
        await captureMailboxMessageMemory({ mailboxId, message, source });
      }
      await queueMailboxMessageMemory({
        mailboxId,
        messageIds: [message.id, message.id],
        userId,
      });
      const events = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.mailboxId, mailboxId));
      const content = events.filter(
        (event) => event.metadata.messageContextOnly !== true
      );
      expect(content).toHaveLength(1);
      expect(content[0]?.metadata).toMatchObject({
        observationKind: "received_message",
        source: "sync",
      });
      const engagement = events.filter(
        (event) => event.metadata.messageContextOnly === true
      );
      expect(engagement).toHaveLength(2);
      expect(engagement.map((event) => event.metadata)).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({ action: "open", source: "open" }),
          expect.objectContaining({ action: "ai_read", source: "ai_read" }),
        ])
      );
      for (const event of engagement) {
        expect(event.metadata.bodyText).toContain("revised launch plan");
        expect(event.metadata.observationKind).toBe("mail_action");
      }
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

    test.each(["reset", "forget"] as const)(
      "a new owner's %s prevents rereading mail from the former owner's checkpoint",
      async (operation) => {
        const mailboxId = await createMailbox({ provider: "managed" });
        const messageId = crypto.randomUUID();
        const now = new Date();
        await db.insert(managedMailMessage).values({
          bodyText: "A private detail that must stay forgotten.",
          createdAt: now,
          direction: "inbound",
          from: "colleague@example.test",
          id: messageId,
          mailboxId,
          mailboxState: "active",
          providerMessageId: messageId,
          sentAt: now,
          threadId: messageId,
          updatedAt: now,
        });
        await queueMailboxMemoryBootstrap({ mailboxId, userId });
        await db
          .update(aiMemoryMailboxState)
          .set({
            receivedComplete: true,
            sentComplete: true,
            status: "completed",
          })
          .where(eq(aiMemoryMailboxState.mailboxId, mailboxId));
        await db
          .update(mailbox)
          .set({ managedOwnerUserId: newOwnerUserId })
          .where(eq(mailbox.id, mailboxId));

        if (operation === "reset") {
          await purgePersonalAiMemory(newOwnerUserId);
        } else {
          const memory = await saveAiMemory({
            category: "preferences",
            content: "Keep replies concise.",
            userId: newOwnerUserId,
          });
          await forgetAiMemory({
            memoryId: memory.id,
            userId: newOwnerUserId,
          });
        }

        await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });

        await expect(
          db
            .select()
            .from(userAiContextEvent)
            .where(eq(userAiContextEvent.mailboxId, mailboxId))
        ).resolves.toHaveLength(0);
        await expect(
          getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
        ).resolves.toMatchObject({ status: "completed" });
      }
    );

    test("an owner's reset completes before a mailbox can transfer to another owner", async () => {
      const mailboxId = await createMailbox({ provider: "managed" });
      const messageId = crypto.randomUUID();
      const now = new Date();
      await db.insert(managedMailMessage).values({
        bodyText: "A private detail that must stay forgotten after transfer.",
        createdAt: now,
        direction: "inbound",
        from: "colleague@example.test",
        id: messageId,
        mailboxId,
        mailboxState: "active",
        providerMessageId: messageId,
        sentAt: now,
        threadId: messageId,
        updatedAt: now,
      });
      await queueMailboxMemoryBootstrap({ mailboxId, userId });
      const locked = Promise.withResolvers<number>();
      const release = Promise.withResolvers<boolean>();
      const blocker = db.transaction(async (tx) => {
        const rows = await tx.execute<{ pid: number }>(sql`
          select pg_backend_pid() as pid
          from ${aiMemoryMailboxState}
          where ${aiMemoryMailboxState.mailboxId} = ${mailboxId}
          for update
        `);
        locked.resolve(rows[0].pid);
        await release.promise;
      });
      const holderPid = await locked.promise;
      let reset: ReturnType<typeof purgePersonalAiMemory> | undefined;
      let transfer: Promise<unknown> | undefined;
      let transferred = false;
      try {
        reset = purgePersonalAiMemory(userId);
        let resetPid: number | undefined;
        await expect
          .poll(async () => {
            const [waiting] = await db.$client<{ pid: number }[]>`
              select pid from pg_stat_activity
              where ${holderPid} = any(pg_blocking_pids(pid))
                and query like 'insert into "aiMemoryMailboxState"%'
            `;
            resetPid = waiting?.pid;
            return resetPid !== undefined;
          })
          .toBeTruthy();
        transfer = db
          .update(mailbox)
          .set({ managedOwnerUserId: newOwnerUserId })
          .where(eq(mailbox.id, mailboxId))
          .then(() => {
            transferred = true;
          });
        await expect
          .poll(async () => {
            const [waiting] = await db.$client<{ blocked: boolean }[]>`
              select exists (
                select 1 from pg_stat_activity
                where ${resetPid ?? 0} = any(pg_blocking_pids(pid))
                  and query like 'update "mailbox"%'
              ) as blocked
            `;
            return transferred || waiting?.blocked;
          })
          .toBeTruthy();
        expect(transferred).toBeFalsy();
      } finally {
        release.resolve(true);
        await blocker;
        await Promise.all([reset, transfer]);
      }

      await purgePersonalAiMemory(newOwnerUserId);
      await processPendingMailMemoryBootstrap({ userId: newOwnerUserId });
      await expect(
        getMailboxMemoryBootstrap({ mailboxId, userId: newOwnerUserId })
      ).resolves.toMatchObject({ status: "completed" });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toHaveLength(0);
    });

    test("a concurrent mailbox deletion makes reset retry without deleting memories", async () => {
      const mailboxId = await createMailbox({ provider: "managed" });
      const content = `Preserve this preference ${crypto.randomUUID()}.`;
      const memory = await saveAiMemory({
        category: "preferences",
        content,
        userId,
      });
      await db
        .update(user)
        .set({ defaultMailboxId: mailboxId })
        .where(eq(user.id, userId));
      const locked = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const deletion = db.transaction(async (tx) => {
        await tx
          .select({ id: mailbox.id })
          .from(mailbox)
          .where(eq(mailbox.id, mailboxId))
          .for("update");
        locked.resolve(true);
        await release.promise;
        await tx
          .update(user)
          .set({ defaultMailboxId: null })
          .where(eq(user.defaultMailboxId, mailboxId));
        await tx.delete(mailbox).where(eq(mailbox.id, mailboxId));
      });
      await locked.promise;
      try {
        await expect(purgePersonalAiMemory(userId)).rejects.toMatchObject({
          code: "CONFLICT",
        });
      } finally {
        release.resolve(true);
        await deletion;
      }

      const memories = await searchAiMemory({ query: content, userId });
      expect(memories.items).toContainEqual(
        expect.objectContaining({ id: memory.id })
      );
      await expect(purgePersonalAiMemory(userId)).resolves.toMatchObject({
        deleted: true,
      });
    });

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
