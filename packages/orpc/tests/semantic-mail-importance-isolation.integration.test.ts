import { classifyMailImportance } from "@quieter/ai/mail-importance";
import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  mailbox,
  mailMessageImportance,
  organization,
  user,
} from "@quieter/database/schema";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { writeGmailCapturedMessage } from "../src/mail-capture";
import { processPendingMailImportance } from "../src/mail-importance";

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
      QUIETER_DEPLOYMENT_ENV: "local" as const,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: false,
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
          "Linked resources are unavailable in isolated capture tests."
        );
      },
    }),
  };
});
vi.mock(import("@quieter/ai/mail-importance"), () => ({
  classifyMailImportance: vi.fn<typeof classifyMailImportance>(),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "search import automation isolation",
  () => {
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const mailboxIds: string[] = [];
    const now = new Date();
    let fixturesMayExist = false;

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
          "Capture isolation tests require disposable loopback PostgreSQL."
        );
      }
      fixturesMayExist = true;
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        emailVerified: false,
        id: userId,
        name: "Search capture fixture",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Search capture fixture",
        slug: organizationId,
      });
    });

    afterAll(async () => {
      if (fixturesMayExist) {
        if (mailboxIds.length > 0) {
          await db.delete(mailbox).where(inArray(mailbox.id, mailboxIds));
        }
        await db
          .delete(organization)
          .where(eq(organization.id, organizationId));
        await db.delete(user).where(eq(user.id, userId));
      }
      await db.$client.end();
    });

    const createSource = async () => {
      const mailboxId = crypto.randomUUID();
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${mailboxId}@example.com`,
        id: mailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        status: "connected",
        updatedAt: now,
      });
      mailboxIds.push(mailboxId);
      const snapshot: CapturedMailSnapshot = {
        attachments: [],
        bodyHtml: null,
        bodyText: "Synthetic historical mail retained for search.",
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "Subject", value: "Historical message" },
        ],
        id: crypto.randomUUID(),
        internalDate: String(now.getTime()),
        labelIds: ["INBOX"],
        providerRevision: "100",
        threadId: crypto.randomUUID(),
        truncation: {
          attachments: false,
          bodyHtml: false,
          bodyText: false,
          headers: false,
        },
      };
      return { mailboxId, snapshot };
    };

    test("recovery leaves search-only retained mail outside automatic importance work", async () => {
      const source = await createSource();
      await writeGmailCapturedMessage({ ...source, source: "search" });
      await processPendingMailImportance({
        limit: 1,
        mailboxId: source.mailboxId,
      });
      const jobs = await db
        .select({ messageId: mailMessageImportance.messageId })
        .from(mailMessageImportance)
        .where(eq(mailMessageImportance.mailboxId, source.mailboxId));
      expect(jobs).toHaveLength(0);
      expect(classifyMailImportance).not.toHaveBeenCalled();
    });

    test.each(["history", "bootstrap", "on_demand", "recovery"] as const)(
      "normal %s capture promotes identical search-first mail exactly once",
      async (normalSource) => {
        const source = await createSource();
        await writeGmailCapturedMessage({ ...source, source: "search" });
        await writeGmailCapturedMessage({ ...source, source: normalSource });
        const identity = and(
          eq(mailMessageImportance.mailboxId, source.mailboxId),
          eq(mailMessageImportance.messageId, source.snapshot.id)
        );
        const jobs = await db
          .select()
          .from(mailMessageImportance)
          .where(identity);
        expect(jobs).toMatchObject([{ state: "pending" }]);
        await db
          .update(mailMessageImportance)
          .set({ state: "completed" })
          .where(identity);
        await writeGmailCapturedMessage({ ...source, source: normalSource });
        const retained = await db
          .select({ source: gmailCapturedMessage.source })
          .from(gmailCapturedMessage)
          .where(
            and(
              eq(gmailCapturedMessage.mailboxId, source.mailboxId),
              eq(gmailCapturedMessage.messageId, source.snapshot.id)
            )
          );
        const afterRepeat = await db
          .select({ state: mailMessageImportance.state })
          .from(mailMessageImportance)
          .where(identity);
        expect(retained).toMatchObject([{ source: normalSource }]);
        expect(afterRepeat).toMatchObject([{ state: "completed" }]);
      }
    );

    test("normal capture still processes a changed message first refreshed by search", async () => {
      const source = await createSource();
      await writeGmailCapturedMessage({ ...source, source: "history" });
      const identity = and(
        eq(mailMessageImportance.mailboxId, source.mailboxId),
        eq(mailMessageImportance.messageId, source.snapshot.id)
      );
      await db
        .update(mailMessageImportance)
        .set({ state: "completed" })
        .where(identity);
      const changed = {
        ...source,
        snapshot: {
          ...source.snapshot,
          bodyText: "A changed message body.",
          providerRevision: "101",
        },
      };
      await writeGmailCapturedMessage({ ...changed, source: "search" });
      await writeGmailCapturedMessage({ ...changed, source: "history" });
      const jobs = await db
        .select({ state: mailMessageImportance.state })
        .from(mailMessageImportance)
        .where(identity);
      expect(jobs).toMatchObject([{ state: "pending" }]);
    });
  }
);
