import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  mailbox,
  mailMessageImportance,
  organization,
  user,
} from "@quieter/database/schema";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  deleteGmailCapturedMessage,
  refreshGmailCapturedMessageMetadata,
  writeGmailCapturedMessage,
  writeGmailCapturedMessageMetadata,
} from "../src/mail-capture";
import { listCapturedImportantMessages } from "../src/mail-importance";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      DATABASE_URL: databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: false,
    },
  };
});

describe.skipIf(databaseUrl === undefined)(
  "retained mail metadata on migrated PostgreSQL",
  () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const mailboxIds: string[] = [];
    const now = new Date();
    const snapshot: CapturedMailSnapshot = {
      attachments: [],
      bodyHtml: null,
      bodyText: "Private retained body",
      headers: [{ name: "From", value: "sender@example.com" }],
      id: "shared-provider-id",
      internalDate: String(now.getTime()),
      labelIds: ["INBOX"],
      providerRevision: "9007199254740993",
      threadId: "shared-thread",
      truncation: {
        attachments: false,
        bodyHtml: false,
        bodyText: false,
        headers: false,
      },
    };

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Metadata tests require a disposable loopback database."
        );
      }
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        emailVerified: false,
        id: userId,
        name: "Metadata fixture",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Metadata fixture",
        slug: organizationId,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    afterAll(async () => {
      await db.delete(mailbox).where(inArray(mailbox.id, mailboxIds));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
    });

    const createMailbox = async () => {
      const id = randomUUID();
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${id}@example.com`,
        id,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        status: "connected",
        updatedAt: now,
      });
      mailboxIds.push(id);
      await writeGmailCapturedMessage({
        mailboxId: id,
        snapshot,
        source: "on_demand",
      });
      return id;
    };

    test("identical read-through capture leaves the mailbox sync revision stable", async () => {
      const mailboxId = await createMailbox();
      const [before] = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot,
        source: "on_demand",
      });
      const [after] = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      expect(after?.contentRevision).toBe(before?.contentRevision);
    });

    test.each(["capture", "delete"])(
      "%s can finish alongside a locked importance update without deadlocking",
      async (operation) => {
        const mailboxId = await createMailbox();
        const locked = Promise.withResolvers<number>();
        const release = Promise.withResolvers<null>();
        const holder = db.transaction(async (tx) => {
          const [record] = await tx
            .select({ pid: sql<number>`pg_backend_pid()` })
            .from(mailMessageImportance)
            .where(
              and(
                eq(mailMessageImportance.mailboxId, mailboxId),
                eq(mailMessageImportance.messageId, snapshot.id)
              )
            )
            .for("update");
          if (record === undefined) {
            throw new Error("Importance fixture is missing.");
          }
          locked.resolve(record.pid);
          await release.promise;
          await tx
            .update(mailMessageImportance)
            .set({ aiImportant: true })
            .where(
              and(
                eq(mailMessageImportance.mailboxId, mailboxId),
                eq(mailMessageImportance.messageId, snapshot.id)
              )
            );
          await tx
            .update(mailbox)
            .set({ contentRevision: sql`${mailbox.contentRevision} + 1` })
            .where(eq(mailbox.id, mailboxId));
        });
        void holder.catch(locked.reject);
        const holderPid = await locked.promise;
        const sourceWrite =
          operation === "capture"
            ? writeGmailCapturedMessage({
                mailboxId,
                snapshot: {
                  ...snapshot,
                  labelIds: ["SPAM"],
                  providerRevision: "9007199254740994",
                },
                source: "history",
              })
            : deleteGmailCapturedMessage({
                mailboxId,
                messageId: snapshot.id,
                providerRevision: "9007199254740994",
              });
        const outcomes = Promise.allSettled([holder, sourceWrite]);
        let blocked = false;
        try {
          const deadline = Date.now() + 5000;
          while (!blocked && Date.now() < deadline) {
            const [state] = await db
              .select({
                blocked: sql<boolean>`exists (select 1 from pg_stat_activity a where ${holderPid} = any(pg_blocking_pids(a.pid)))`,
              })
              .from(mailbox)
              .where(eq(mailbox.id, mailboxId));
            ({ blocked } = state);
            if (!blocked) {
              await delay(10);
            }
          }
        } finally {
          release.resolve(null);
        }
        const results = await outcomes;
        expect(blocked).toBeTruthy();
        expect(results).toMatchObject([
          { status: "fulfilled" },
          { status: "fulfilled" },
        ]);
        const [captured] = await db
          .select()
          .from(gmailCapturedMessage)
          .where(
            and(
              eq(gmailCapturedMessage.mailboxId, mailboxId),
              eq(gmailCapturedMessage.messageId, snapshot.id)
            )
          );
        expect(captured?.deletedAt instanceof Date).toBe(
          operation === "delete"
        );
        expect(captured?.snapshot?.labelIds.includes("SPAM") ?? false).toBe(
          operation === "capture"
        );
      }
    );

    test.each(["TRASH", "SPAM"])(
      "refreshing %s hides Important immediately and restore preserves its classification",
      async (label) => {
        const mailboxId = await createMailbox();
        await db
          .update(mailMessageImportance)
          .set({ aiImportant: true, manualImportant: true, state: "completed" })
          .where(eq(mailMessageImportance.mailboxId, mailboxId));
        const [before] = await db
          .select()
          .from(mailMessageImportance)
          .where(eq(mailMessageImportance.mailboxId, mailboxId));
        const provider = {
          labelIds: [label],
          providerRevision: "9007199254740994",
        };
        vi.stubGlobal(
          "fetch",
          vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init);
            const url = new URL(request.url);
            expect(request.method).toBe("GET");
            expect(url.origin).toBe("https://gmail.googleapis.com");
            expect(url.searchParams.get("format")).toBe("minimal");
            return Response.json({
              historyId: provider.providerRevision,
              id: snapshot.id,
              labelIds: provider.labelIds,
            });
          })
        );
        await refreshGmailCapturedMessageMetadata({
          accessToken: "synthetic-token",
          mailboxId,
          messageIds: [snapshot.id, "not-retained"],
        });
        const hidden = await listCapturedImportantMessages({ mailboxId });
        expect(hidden.messages).toHaveLength(0);
        provider.labelIds = ["INBOX"];
        provider.providerRevision = "9007199254740995";
        await refreshGmailCapturedMessageMetadata({
          accessToken: "synthetic-token",
          mailboxId,
          messageIds: [snapshot.id],
        });
        const restored = await listCapturedImportantMessages({ mailboxId });
        expect(restored.messages).toContainEqual(
          expect.objectContaining({ id: snapshot.id, isImportant: true })
        );
        const [after] = await db
          .select()
          .from(mailMessageImportance)
          .where(eq(mailMessageImportance.mailboxId, mailboxId));
        expect(after).toMatchObject({
          aiImportant: true,
          attemptCount: before?.attemptCount,
          contentHash: before?.contentHash,
          manualImportant: true,
          state: "completed",
        });
        const [captured] = await db
          .select()
          .from(gmailCapturedMessage)
          .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
        expect(captured?.snapshot?.bodyText).toContain("Private retained body");
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      }
    );

    test("stale metadata cannot replace a newer watch response or revive a tombstone and stays mailbox scoped", async () => {
      const mailboxId = await createMailbox();
      const otherMailboxId = await createMailbox();
      const delayedInput = {
        labelIds: ["TRASH"],
        mailboxId,
        messageId: snapshot.id,
        providerRevision: "9007199254740994",
      };
      await writeGmailCapturedMessage({
        mailboxId,
        snapshot: {
          ...snapshot,
          labelIds: ["SPAM"],
          providerRevision: "9007199254740995",
        },
        source: "history",
      });
      const [before] = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      await writeGmailCapturedMessageMetadata(delayedInput);
      await writeGmailCapturedMessageMetadata({
        ...delayedInput,
        labelIds: ["SPAM"],
        providerRevision: "9007199254740995",
      });
      const [unchanged] = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      expect(unchanged?.contentRevision).toBe(before?.contentRevision);
      const [current] = await db
        .select()
        .from(gmailCapturedMessage)
        .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
      expect(current?.snapshot?.labelIds).toContain("SPAM");
      await deleteGmailCapturedMessage({
        mailboxId,
        messageId: snapshot.id,
        providerRevision: "9007199254740996",
      });
      await writeGmailCapturedMessageMetadata({
        ...delayedInput,
        providerRevision: "9007199254740997",
      });
      const [deleted] = await db
        .select()
        .from(gmailCapturedMessage)
        .where(eq(gmailCapturedMessage.mailboxId, mailboxId));
      expect(deleted?.snapshot).toBeNull();
      expect(deleted?.deletedAt).toBeInstanceOf(Date);
      const [isolated] = await db
        .select()
        .from(gmailCapturedMessage)
        .where(
          and(
            eq(gmailCapturedMessage.mailboxId, otherMailboxId),
            eq(gmailCapturedMessage.messageId, snapshot.id)
          )
        );
      expect(isolated?.snapshot?.labelIds).toContain("INBOX");
      expect(isolated?.snapshot?.bodyText).toContain("Private retained body");
    });
  }
);
