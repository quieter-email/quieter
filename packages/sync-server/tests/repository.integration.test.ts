import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { mailSyncStream } from "@quieter/database/schema";
import type { SyncBatch } from "@quieter/sync";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { SyncCommands } from "../src/commands";
import { synchronizeGmail } from "../src/providers/gmail";
import type { GmailSyncProvider } from "../src/providers/gmail";
import { SyncRepository } from "../src/repository";

// Test bootstrap accepts only the disposable integration databases, never quieter_dev.
const databaseUrl =
  process.env.SYNC_TEST_DATABASE_URL ?? process.env.MIGRATION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("transactional mail replication", () => {
  const schemaName = `sync_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let connection: ReturnType<typeof postgres>;
  let admin: ReturnType<typeof postgres>;
  let repository: SyncRepository;
  let deliver: (batch: SyncBatch) => Promise<void>;
  const failures: unknown[] = [];

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("A disposable sync test database is required.");
    }
    const url = new URL(databaseUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["/quieter_sync_test", "/quieter_migration_test"].includes(url.pathname)
    ) {
      throw new Error(
        "Sync integration tests require an explicitly named loopback test database."
      );
    }
    admin = postgres(databaseUrl, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    connection = postgres(databaseUrl, {
      connection: { search_path: schemaName },
      max: 3,
    });
    await connection.unsafe(
      'CREATE TABLE "mailbox" (id text PRIMARY KEY); CREATE TABLE "user" (id text PRIMARY KEY);'
    );
    await connection.unsafe(`
      CREATE TABLE "gmailLabel" (
        "mailboxId" text, "labelId" text, name text, color text,
        description text, "inclusionCriteria" text, "createdAt" timestamp, "updatedAt" timestamp
      );
      CREATE TABLE "managedMailSavedView" (
        id text, "mailboxId" text, "ownerUserId" text, name text, "normalizedName" text,
        color text, icon text, search jsonb, sort text, position integer,
        "disabledReason" text, "createdAt" timestamp, "updatedAt" timestamp
      );
    `);
    for (const migration of [
      "20260909092211_unknown_princess_powerful",
      "20260909094318_glorious_white_queen",
    ]) {
      const source = await readFile(
        new URL(
          `../../database/drizzle/${migration}/migration.sql`,
          import.meta.url
        ),
        "utf-8"
      );
      await connection.unsafe(source);
    }
    deliver = async () => {
      await Promise.resolve();
    };
    repository = new SyncRepository(
      drizzle({ client: connection }),
      async (batch) => {
        await deliver(batch);
      },
      (error) => {
        failures.push(error);
      }
    );
  });

  afterAll(async () => {
    await connection?.end();
    if (admin !== undefined) {
      await admin.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await admin.end();
    }
  });

  it("delivers the committed payload only after it is visible to another database connection", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    let observed = false;
    deliver = async (batch) => {
      const rows =
        await connection`SELECT changes FROM "mailSyncChange" WHERE "mailboxId" = ${mailboxId}`;
      observed =
        rows.length === 1 && isDeepStrictEqual(rows[0].changes, batch.changes);
    };
    await repository.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "label", value: { id: "label", name: "Work" } },
        id: "label",
        kind: "label",
      });
      await Promise.resolve();
    });
    expect(observed).toBeTruthy();
    await expect(
      connection`SELECT * FROM "mailSyncOutbox" WHERE "mailboxId" = ${mailboxId}`
    ).resolves.toHaveLength(0);
  });

  it("rolls back state and history together without a notification", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    let notified = false;
    deliver = async () => {
      notified = true;
      await Promise.resolve();
    };
    await expect(
      repository.transaction(mailboxId, async ({ put }) => {
        put({
          data: { kind: "label", value: { id: "label", name: "Work" } },
          id: "label",
          kind: "label",
        });
        await Promise.resolve();
        throw new Error("Simulated transaction failure");
      })
    ).rejects.toThrow("Simulated transaction failure");
    await expect(repository.head(mailboxId)).resolves.toBeNull();
    expect(notified).toBeFalsy();
  });

  it("orders commits even when concurrent delivery arrives in reverse order", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    const firstCommitted = Promise.withResolvers<boolean>();
    const secondDelivered = Promise.withResolvers<boolean>();
    const observed: string[] = [];
    deliver = async (batch) => {
      if (batch.sequence === "1") {
        firstCommitted.resolve(true);
        await secondDelivered.promise;
      }
      observed.push(batch.sequence);
      if (batch.sequence === "2") {
        secondDelivered.resolve(true);
      }
    };
    const first = repository.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "label", value: { id: "label", name: "First" } },
        id: "label",
        kind: "label",
      });
      await Promise.resolve();
    });
    await firstCommitted.promise;
    await repository.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "label", value: { id: "label", name: "Second" } },
        id: "label",
        kind: "label",
      });
      await Promise.resolve();
    });
    await first;
    const checkpoint = await repository.head(mailboxId);
    if (checkpoint === null) {
      throw new Error("Missing committed stream.");
    }
    const replay = await repository.replay(mailboxId, {
      ...checkpoint,
      sequence: "0",
    });
    expect(observed).toStrictEqual(["2", "1"]);
    expect(replay.batches.map((batch) => batch.sequence)).toStrictEqual([
      "1",
      "2",
    ]);
  });

  it("retains failed delivery through pruning, then recovers and expires old checkpoints", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    deliver = async () => {
      await Promise.resolve();
      throw new Error("Delivery unavailable");
    };
    await repository.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "label", value: { id: "label", name: "Durable" } },
        id: "label",
        kind: "label",
      });
      await Promise.resolve();
    });
    const checkpoint = await repository.head(mailboxId);
    if (checkpoint === null) {
      throw new Error("Missing committed stream.");
    }
    await connection`UPDATE "mailSyncChange" SET "createdAt" = now() - interval '30 days' WHERE "mailboxId" = ${mailboxId}`;
    await repository.prune(mailboxId);
    const retainedReplay = await repository.replay(mailboxId, {
      ...checkpoint,
      sequence: "0",
    });
    expect(retainedReplay.reset).toBeFalsy();
    deliver = async () => {
      await Promise.resolve();
    };
    await expect(repository.recoverOutbox()).resolves.toBe(1);
    await repository.prune(mailboxId);
    const expiredReplay = await repository.replay(mailboxId, {
      ...checkpoint,
      sequence: "0",
    });
    expect(expiredReplay.reset).toBeTruthy();
    expect(failures.length).toBeGreaterThan(0);
  });

  it("returns a bounded snapshot with a consistent checkpoint and empty requested coverage", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    deliver = async () => {
      await Promise.resolve();
    };
    await repository.transaction(mailboxId, async ({ put, database }) => {
      put({
        data: { kind: "label", value: { id: "label", name: "Current" } },
        id: "label",
        kind: "label",
      });
      await database
        .update(mailSyncStream)
        .set({ initialized: true })
        .where(eq(mailSyncStream.mailboxId, mailboxId));
    });
    const snapshot = await repository.snapshot(mailboxId);
    expect(snapshot?.entities).toHaveLength(1);
    expect(
      snapshot?.entities.every(
        (entity) =>
          BigInt(entity.version) <= BigInt(snapshot.checkpoint.sequence)
      )
    ).toBeTruthy();
    const emptySnapshot = await repository.snapshot(mailboxId, []);
    expect(emptySnapshot?.entities).toStrictEqual([]);
  });

  it("accepts an action once and executes concurrent actions in commit order", async () => {
    const mailboxId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    await connection`INSERT INTO "user" (id) VALUES (${userId})`;
    const executed: string[] = [];
    const commands = new SyncCommands(repository, {
      classifyError: () => ({ message: "Retry", permanent: false }),
      execute: async (command) => {
        executed.push(command.commandId);
        await Promise.resolve();
        return {};
      },
      reportError: (error) => {
        failures.push(error);
      },
    });
    const first = {
      command: { kind: "set-read" as const, read: true },
      commandId: crypto.randomUUID(),
      mailboxId,
      targets: [{ messageIds: ["message"], threadId: "thread" }],
    };
    const second = {
      ...first,
      command: { kind: "set-read" as const, read: false },
      commandId: crypto.randomUUID(),
    };
    await commands.submit(userId, first);
    const checkpoint = await repository.head(mailboxId);
    await commands.submit(userId, first);
    await expect(repository.head(mailboxId)).resolves.toStrictEqual(checkpoint);
    await expect(
      commands.submit(userId, { ...first, command: second.command })
    ).rejects.toThrow("already used");
    await commands.submit(userId, second);
    await commands.process(mailboxId);
    await commands.process(mailboxId);
    expect(executed).toStrictEqual([first.commandId, second.commandId]);
    await expect(commands.process(mailboxId)).resolves.toBeFalsy();
    const rows = await connection<
      { status: string }[]
    >`SELECT status FROM "mailSyncCommand" WHERE "mailboxId"=${mailboxId}`;
    expect(rows.map((row) => row.status)).toStrictEqual(["applied", "applied"]);
  });

  it("blocks later actions behind a retry and publishes a terminal failure", async () => {
    const mailboxId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    await connection`INSERT INTO "user" (id) VALUES (${userId})`;
    let permanent = false;
    const commands = new SyncCommands(repository, {
      classifyError: () => ({ message: "Action unavailable", permanent }),
      execute: async () => {
        await Promise.resolve();
        throw new Error("Unavailable");
      },
      reportError: (error) => {
        failures.push(error);
      },
    });
    const command = {
      command: { kind: "set-read" as const, read: true },
      commandId: crypto.randomUUID(),
      mailboxId,
      targets: [{ messageIds: ["message"], threadId: "thread" }],
    };
    await commands.submit(userId, command);
    await commands.process(mailboxId);
    await expect(commands.process(mailboxId)).rejects.toThrow(
      "already running"
    );
    permanent = true;
    await connection`UPDATE "mailSyncCommand" SET "nextAttemptAt"=now() - interval '1 second' WHERE "mailboxId"=${mailboxId}`;
    await commands.process(mailboxId);
    const rows =
      await connection`SELECT status, error, attempts FROM "mailSyncCommand" WHERE "mailboxId"=${mailboxId}`;
    expect(rows[0]).toMatchObject({
      attempts: 2,
      error: "Action unavailable",
      status: "failed",
    });
  });

  it("imports Gmail bodies and advances paginated history after its final page commits", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    const stored = new Map<string, Uint8Array>();
    const bodies = {
      delete: async (key: string) => {
        stored.delete(key);
        await Promise.resolve();
      },
      get: async (key: string) => {
        await Promise.resolve();
        return stored.get(key) ?? null;
      },
      put: async (key: string, bytes: Uint8Array) => {
        stored.set(key, bytes);
        await Promise.resolve();
      },
    };
    let paginated = false;
    const observed: string[] = [];
    const provider: GmailSyncProvider = {
      history: async (cursor, pageToken) => {
        observed.push(`${cursor}:${pageToken ?? "first"}`);
        await Promise.resolve();
        return {
          expired: false,
          historyId: paginated ? "30" : "20",
          nextPageToken:
            paginated && pageToken === undefined ? "next" : undefined,
          threadIds: ["thread"],
        };
      },
      labels: async () => {
        await Promise.resolve();
        return [{ id: "INBOX", name: "Inbox" }];
      },
      profile: async () => {
        await Promise.resolve();
        return { emailAddress: "fixture@example.invalid", historyId: "10" };
      },
      thread: async () => {
        await Promise.resolve();
        return {
          messages: [
            {
              bodyText: "Already stored before notification",
              id: "message",
              internalDate: "1000",
              labelIds: ["INBOX"],
              threadId: "thread",
            },
          ],
          threadId: "thread",
        };
      },
      threads: async () => {
        await Promise.resolve();
        return { resultSizeEstimate: 1, threads: [{ id: "thread" }] };
      },
      unreadCount: async () => {
        await Promise.resolve();
        return 1;
      },
    };
    await synchronizeGmail(repository, bodies, mailboxId, provider);
    expect(stored.size).toBe(1);
    paginated = true;
    await synchronizeGmail(repository, bodies, mailboxId, provider);
    const [unfinished] =
      await connection`SELECT cursor, "historyPageToken" FROM "mailSyncProviderState" WHERE "mailboxId"=${mailboxId}`;
    expect(unfinished).toMatchObject({
      cursor: "20",
      historyPageToken: "next",
    });
    await synchronizeGmail(repository, bodies, mailboxId, provider);
    expect(observed).toStrictEqual(["10:first", "20:first", "20:next"]);
    const [finished] =
      await connection`SELECT cursor, "historyPageToken" FROM "mailSyncProviderState" WHERE "mailboxId"=${mailboxId}`;
    expect(finished).toMatchObject({ cursor: "30", historyPageToken: null });
  });
});
