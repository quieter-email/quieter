import type { DatabaseClient } from "@quieter/database/client";
import { gmailComposeOperation } from "@quieter/database/schema";
import type * as gmail from "@quieter/gmail";
import type { MessageListItem } from "@quieter/mail/messages";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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
  hydrateUnsubscribeStatus,
  sendGmailUnsubscribe,
} from "../src/gmail-compose";
import { cleanupGmailComposeOperations } from "../src/gmail-compose-retention";
import { composeMailOperations } from "../src/mail/compose";
import type * as feedback from "../src/mail/feedback";
import { queriesMailOperations } from "../src/mail/queries";

const fixture = vi.hoisted(() => ({
  database: null as DatabaseClient | null,
  delta: vi.fn<typeof gmail.getMailboxSyncDelta>(),
  findSent: vi.fn<typeof gmail.findGmailComposeSentMessage>(),
  learn: vi.fn<typeof feedback.learnAiMemoryFromMailAction>(),
  metadata: vi.fn<typeof gmail.getGmailMessageMetadata>(),
  page: vi.fn<typeof gmail.listMessagesWithDetails>(),
  send: vi.fn<typeof gmail.sendRawMessage>(),
  thread: vi.fn<typeof gmail.getThreadWithDetails>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Exercise the real SQL predicates and constraints in an isolated schema.
vi.mock("@quieter/database/client", () => ({
  get db() {
    if (!fixture.database) {
      throw new Error("Test database is not ready.");
    }
    return fixture.database;
  },
}));
vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  findGmailComposeSentMessage: fixture.findSent,
  getGmailMessageMetadata: fixture.metadata,
  getMailboxSyncDelta: fixture.delta,
  getThreadWithDetails: fixture.thread,
  listMessagesWithDetails: fixture.page,
  sendRawMessage: fixture.send,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    requireServerEnv: (name: Parameters<typeof actual.requireServerEnv>[0]) =>
      name === "GMAIL_TOKEN_ENCRYPTION_KEY"
        ? "fixture"
        : actual.requireServerEnv(name),
    serverEnv: {
      ...actual.serverEnv,
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: undefined,
    },
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: () => "fixture-token",
  encryptGmailCredentialSecret: () => "fixture-encrypted-token",
}));
vi.mock(import("../src/mail-importance"), async (original) => ({
  ...(await original()),
  hydrateMailImportance: async <T extends MessageListItem>(
    _mailboxId: string,
    messages: T[]
  ) => await Promise.resolve(messages),
}));
vi.mock(import("../src/mail/feedback"), () => ({
  learnAiMemoryFromMailAction: fixture.learn,
}));

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite("remembered Gmail unsubscribe requests", () => {
  const schema = `unsubscribe_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof postgres>;
  let connection: ReturnType<typeof postgres>;
  const key = "list:updates.example.com";
  const input = {
    key,
    message: {
      body: "unsubscribe",
      subject: "Stop updates",
      to: "remove@example.com",
    },
  };
  const message: MessageListItem = {
    from: "Updates <updates@example.com>",
    id: "message",
    threadId: "thread",
    unsubscribeKey: key,
    unsubscribeMailto: "mailto:remove@example.com",
  };
  const context = { userId: "owner" };

  beforeAll(async () => {
    const url = new URL(databaseUrl ?? "");
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/quieter_migration_test"
    ) {
      throw new Error(
        "Unsubscribe integration tests require loopback quieter_migration_test."
      );
    }
    admin = postgres(databaseUrl ?? "", { max: 1 });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    connection = postgres(databaseUrl ?? "", {
      connection: { search_path: schema },
      max: 3,
    });
    await connection.unsafe(`CREATE TABLE "gmailComposeOperation" (
      id text PRIMARY KEY, "mailboxId" text NOT NULL, "operationKey" text NOT NULL,
      kind text NOT NULL, "requestHash" text NOT NULL, "messageHeaderId" text NOT NULL,
      "draftId" text, response jsonb, status text NOT NULL,
      "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL,
      UNIQUE ("mailboxId", "operationKey")
    );
    CREATE UNIQUE INDEX active_draft_send ON "gmailComposeOperation" ("mailboxId", "draftId") WHERE kind='send' AND status IN ('submitting','unknown','accepted');
    CREATE TABLE mailbox (id text PRIMARY KEY, "ownerUserId" text, provider text, status text, "emailAddress" text, "organizationId" text, "contentRevision" bigint DEFAULT 0);
    CREATE TABLE "gmailCredential" ("mailboxId" text PRIMARY KEY, "accessTokenExpiresAt" timestamp, "encryptedAccessToken" text, "encryptedRefreshToken" text, scopes text NOT NULL DEFAULT '');
    INSERT INTO mailbox VALUES ('mailbox','owner','gmail','connected','owner@example.com','organization',0), ('other','other-owner','gmail','connected','other@example.com','organization',0);
    INSERT INTO "gmailCredential" ("mailboxId", "accessTokenExpiresAt", "encryptedAccessToken", "encryptedRefreshToken") VALUES ('mailbox','2100-01-01','fixture',null), ('other','2100-01-01','fixture',null);
    CREATE TABLE acceptance_failure (enabled boolean);
    INSERT INTO acceptance_failure VALUES (false);
    CREATE FUNCTION reject_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status = 'accepted' AND (SELECT enabled FROM acceptance_failure) THEN RAISE EXCEPTION 'acceptance unavailable'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER acceptance_failure BEFORE UPDATE ON "gmailComposeOperation" FOR EACH ROW EXECUTE FUNCTION reject_acceptance();`);
    fixture.database = drizzle({ client: connection });
  });
  beforeEach(async () => {
    await connection`DELETE FROM "gmailComposeOperation"`;
    await connection`UPDATE acceptance_failure SET enabled=false`;
    fixture.send
      .mockReset()
      .mockResolvedValue({ id: "sent", threadId: "sent-thread" });
    fixture.findSent.mockReset().mockResolvedValue(null);
    fixture.learn.mockReset().mockResolvedValue({ status: "skipped" });
    fixture.metadata.mockReset().mockResolvedValue({
      id: message.id,
      payload: {
        headers: [
          { name: "List-Id", value: "Updates <updates.example.com>" },
          { name: "From", value: message.from ?? "" },
          {
            name: "List-Unsubscribe",
            value: "<mailto:remove@example.com?subject=Stop>",
          },
        ],
      },
      threadId: message.threadId,
    });
    fixture.page.mockReset().mockResolvedValue({ messages: [message] });
    fixture.thread
      .mockReset()
      .mockResolvedValue({ messages: [message], threadId: message.threadId });
    fixture.delta.mockReset().mockResolvedValue({
      hasChanges: true,
      refreshFirstPage: false,
      removedMessageIds: [],
      requiresFullRefresh: false,
      updatedMessages: [message],
    });
  });

  afterAll(async () => {
    await connection?.end();
    if (admin !== undefined) {
      await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  test("concurrent messages from one list submit once, and changed tokens stay remembered", async () => {
    const started = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    fixture.send.mockImplementation(async () => {
      started.resolve(true);
      await release.promise;
      return { id: "sent", threadId: "sent-thread" };
    });
    const first = sendGmailUnsubscribe("token", "mailbox", input);
    await started.promise;
    try {
      await expect(
        sendGmailUnsubscribe("token", "mailbox", {
          key,
          message: { ...input.message, to: "another-token@example.com" },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      release.resolve(true);
    }
    await first;
    await expect(
      sendGmailUnsubscribe("token", "mailbox", {
        key,
        message: { ...input.message, body: "changed token" },
      })
    ).resolves.toMatchObject({ idempotent: true });
    expect(fixture.send).toHaveBeenCalledOnce();
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "requested" }]);
    const [other] = await hydrateUnsubscribeStatus("other", [message]);
    expect(other?.unsubscribeStatus).toBeUndefined();
    await sendGmailUnsubscribe("token", "other", input);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  test("unknown delivery never resends and reconciles with its original Message-ID", async () => {
    fixture.send.mockRejectedValue(new Error("Response lost"));
    await expect(
      sendGmailUnsubscribe("token", "mailbox", input)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "confirming" }]);
    await expect(
      sendGmailUnsubscribe("token", "mailbox", input)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    fixture.findSent.mockResolvedValue({ id: "sent", threadId: "sent-thread" });
    await sendGmailUnsubscribe("token", "mailbox", input);
    const raw = Buffer.from(
      fixture.send.mock.calls[0]?.[1] ?? "",
      "base64url"
    ).toString("utf8");
    const persistedMessageId = /^Message-ID:\s*(?<id>[^\r\n]+)/imu.exec(raw)
      ?.groups?.id;
    expect(persistedMessageId).toBeTruthy();
    expect(
      fixture.findSent.mock.calls.every(
        (call) => call[1] === persistedMessageId
      )
    ).toBeTruthy();
    expect(fixture.send).toHaveBeenCalledOnce();
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "requested" }]);
  });

  test("acceptance must persist before success and a later check recovers without another send", async () => {
    await connection`UPDATE acceptance_failure SET enabled=true`;
    await expect(
      sendGmailUnsubscribe("token", "mailbox", input)
    ).rejects.toBeInstanceOf(Error);
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "confirming" }]);
    await connection`UPDATE acceptance_failure SET enabled=false`;
    fixture.findSent.mockResolvedValue({ id: "sent", threadId: "sent-thread" });
    await sendGmailUnsubscribe("token", "mailbox", input);
    expect(fixture.send).toHaveBeenCalledOnce();
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "requested" }]);
  });

  test("a late provider failure cannot overwrite concurrently reconciled acceptance", async () => {
    const started = Promise.withResolvers<boolean>();
    const provider = Promise.withResolvers<gmail.GmailMessage>();
    fixture.send.mockImplementation(async () => {
      started.resolve(true);
      return await provider.promise;
    });
    const first = (async () => {
      try {
        return await sendGmailUnsubscribe("token", "mailbox", input);
      } catch (error) {
        return error;
      }
    })();
    await started.promise;
    fixture.findSent.mockResolvedValue({ id: "sent", threadId: "sent-thread" });
    await sendGmailUnsubscribe("token", "mailbox", input);
    provider.reject(new Error("Response lost after acceptance"));
    await expect(first).resolves.toMatchObject({ code: "CONFLICT" });
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "requested" }]);
    await sendGmailUnsubscribe("token", "mailbox", input);
    expect(fixture.send).toHaveBeenCalledOnce();
  });

  test("a rejected send stays available and can be retried", async () => {
    fixture.send.mockRejectedValueOnce(
      Object.assign(new Error("Rejected"), { status: 400 })
    );
    await expect(
      sendGmailUnsubscribe("token", "mailbox", input)
    ).rejects.toMatchObject({ status: 400 });
    const [failed] = await hydrateUnsubscribeStatus("mailbox", [message]);
    expect(failed?.unsubscribeStatus).toBeUndefined();
    await sendGmailUnsubscribe("token", "mailbox", input);
    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  test("accepted requests survive receipt cleanup", async () => {
    await sendGmailUnsubscribe("token", "mailbox", input);
    await fixture.database
      ?.update(gmailComposeOperation)
      .set({ updatedAt: new Date("2000-01-01") })
      .where(eq(gmailComposeOperation.mailboxId, "mailbox"));
    await cleanupGmailComposeOperations();
    await sendGmailUnsubscribe("token", "mailbox", input);
    expect(fixture.send).toHaveBeenCalledOnce();
    await expect(
      hydrateUnsubscribeStatus("mailbox", [message])
    ).resolves.toMatchObject([{ unsubscribeStatus: "requested" }]);
  });

  test("owner authorization precedes metadata access and all successful read paths hydrate receipts", async () => {
    await expect(
      composeMailOperations.unsubscribeFromMessage({
        context: { userId: "other-owner" },
        input: { mailboxId: "mailbox", messageId: message.id },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.metadata).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
    fixture.learn.mockRejectedValue(new Error("Memory unavailable"));
    await expect(
      composeMailOperations.unsubscribeFromMessage({
        context,
        input: { mailboxId: "mailbox", messageId: message.id },
      })
    ).resolves.toMatchObject({ newlyRequested: true, status: "requested" });
    const page = await queriesMailOperations.listThreads({
      context,
      input: { category: "inbox", mailboxId: "mailbox" },
    });
    const thread = await queriesMailOperations.getThread({
      context,
      input: { mailboxId: "mailbox", threadId: message.threadId },
    });
    const delta = await queriesMailOperations.syncMailbox({
      context,
      input: {
        category: "inbox",
        mailboxId: "mailbox",
        startHistoryId: "before",
      },
    });
    expect(page.messages).toMatchObject([{ unsubscribeStatus: "requested" }]);
    expect(thread.messages).toMatchObject([{ unsubscribeStatus: "requested" }]);
    expect(delta.updatedMessages).toMatchObject([
      { unsubscribeStatus: "requested" },
    ]);
  });

  test("malformed unsubscribe addresses remain expected validation failures", async () => {
    fixture.metadata.mockResolvedValue({
      id: message.id,
      payload: {
        headers: [
          { name: "From", value: message.from ?? "" },
          { name: "List-Unsubscribe", value: "<mailto:%E0%A4%A>" },
        ],
      },
      threadId: message.threadId,
    });
    await expect(
      composeMailOperations.unsubscribeFromMessage({
        context,
        input: { mailboxId: "mailbox", messageId: message.id },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.send).not.toHaveBeenCalled();
  });
});
