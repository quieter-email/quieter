import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { mailSyncStream } from "@quieter/database/schema";
import { syncMessageSchema } from "@quieter/sync";
import type { SyncBatch } from "@quieter/sync";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { collectSyncBodies } from "../src/body-collection";
import { SyncCommands } from "../src/commands";
import { projectManagedDelivery } from "../src/delivery";
import { readSyncHealth } from "../src/health";
import { synchronizeGmail } from "../src/providers/gmail";
import type { GmailSyncProvider } from "../src/providers/gmail";
import { SyncRepository } from "../src/repository";
import { SyncSubmissions } from "../src/submissions";

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
      ALTER TABLE mailbox ADD COLUMN "organizationId" text;
      CREATE TABLE "managedMailMessage" (
        id text PRIMARY KEY, "mailboxId" text, "providerMessageId" text, "threadId" text, direction text, "mailboxState" text
      );
      CREATE TABLE "organizationMailDeliveryRecipient" (
        "createdAt" timestamptz, "lastEventAt" timestamptz, "organizationId" text,
        "providerMessageId" text, recipient text, status text, "updatedAt" timestamptz
      );
      CREATE TABLE "organizationMailDeliveryEvent" (
        "createdAt" timestamptz, "organizationId" text, "providerMessageId" text
      );
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
      "20260909115700_flat_speedball",
      "20260909125850_chief_matthew_murdock",
      "20260909130337_parallel_viper",
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
    await expect(readSyncHealth(repository.database)).resolves.toMatchObject({
      oldestOutboxMs: 0,
      pendingOutbox: 0,
    });
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

  it("collects only unreferenced bodies outside replay retention and initializes older projections", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    deliver = async () => {
      await Promise.resolve();
    };
    const hash = "a".repeat(64);
    const orphan = "b".repeat(64);
    const stored = new Set([hash, orphan]);
    const store = {
      delete: async (key: string) => {
        stored.delete(key.slice(-64));
        await Promise.resolve();
      },
    };
    const uploaded = new Date(Date.now() - 40 * 86_400_000);
    const message = syncMessageSchema.parse({
      attachments: [],
      body: { bytes: 10, hash },
      id: "message",
      isUnread: false,
      labelIds: [],
      threadId: "thread",
    });
    await repository.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "message", value: message },
        id: message.id,
        kind: "message",
      });
      put({
        data: { kind: "message", value: { ...message, id: "second" } },
        id: "second",
        kind: "message",
      });
      await Promise.resolve();
    });
    await repository.transaction(mailboxId, async ({ put }) => {
      put({ data: null, id: message.id, kind: "message" });
      await Promise.resolve();
    });
    await connection`DELETE FROM "mailSyncBody" WHERE "mailboxId"=${mailboxId}`;
    await connection`UPDATE "mailSyncStream" SET "bodyReferencesInitializedAt"=NULL WHERE "mailboxId"=${mailboxId}`;
    await expect(
      collectSyncBodies(repository.database, store, [
        { hash, mailboxId, uploaded },
        { hash: orphan, mailboxId, uploaded: new Date() },
      ])
    ).resolves.toMatchObject({ deleted: 0 });
    const [reference] =
      await connection`SELECT "references" FROM "mailSyncBody" WHERE "mailboxId"=${mailboxId} AND hash=${hash}`;
    expect(reference.references).toBe(1);
    await repository.transaction(mailboxId, async ({ put }) => {
      put({ data: null, id: "second", kind: "message" });
      await Promise.resolve();
    });
    await connection`DELETE FROM "mailSyncBody" WHERE "mailboxId"=${mailboxId}`;
    await connection`UPDATE "mailSyncStream" SET "bodyReferencesInitializedAt"=NULL WHERE "mailboxId"=${mailboxId}`;
    await expect(
      collectSyncBodies(repository.database, store, [
        { hash, mailboxId, uploaded },
      ])
    ).resolves.toMatchObject({ deleted: 0 });
    await connection`UPDATE "mailSyncChange" SET "createdAt"=now()-interval '30 days' WHERE "mailboxId"=${mailboxId}`;
    await repository.prune(mailboxId);
    await expect(
      collectSyncBodies(repository.database, store, [
        { hash, mailboxId, uploaded },
        { hash: orphan, mailboxId, uploaded },
      ])
    ).resolves.toMatchObject({ deleted: 2 });
    expect(stored.size).toBe(0);
  });

  it("fences a prepared upload that races body collection before commit", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    const hash = "c".repeat(64);
    const key = `sync/bodies/${mailboxId}/${hash}`;
    const stored = new Map<string, Uint8Array>([[key, new Uint8Array([1])]]);
    const deleting = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    const bodies = {
      delete: async (bodyKey: string) => {
        deleting.resolve(true);
        await release.promise;
        stored.delete(bodyKey);
      },
      get: async (bodyKey: string) => {
        await Promise.resolve();
        return stored.get(bodyKey) ?? null;
      },
      has: async (bodyKey: string) => {
        await Promise.resolve();
        return stored.has(bodyKey);
      },
      put: async (bodyKey: string, bytes: Uint8Array) => {
        stored.set(bodyKey, bytes);
        await Promise.resolve();
      },
    };
    const guarded = new SyncRepository(
      repository.database,
      async () => {
        await Promise.resolve();
      },
      (error) => {
        failures.push(error);
      },
      bodies
    );
    const collecting = collectSyncBodies(repository.database, bodies, [
      { hash, mailboxId, uploaded: new Date(Date.now() - 40 * 86_400_000) },
    ]);
    await deleting.promise;
    await bodies.put(key, new Uint8Array([2]));
    const message = syncMessageSchema.parse({
      attachments: [],
      body: { bytes: 1, hash },
      id: "message",
      isUnread: false,
      labelIds: [],
      threadId: "thread",
    });
    const failedCommit = guarded.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "message", value: message },
        id: message.id,
        kind: "message",
      });
      await Promise.resolve();
    });
    release.resolve(true);
    await Promise.all([
      collecting,
      expect(failedCommit).rejects.toThrow("expired before it was committed"),
    ]);
    await expect(guarded.head(mailboxId)).resolves.toBeNull();
    await bodies.put(key, new Uint8Array([2]));
    await guarded.transaction(mailboxId, async ({ put }) => {
      put({
        data: { kind: "message", value: message },
        id: message.id,
        kind: "message",
      });
      await Promise.resolve();
    });
    await expect(guarded.head(mailboxId)).resolves.toMatchObject({
      sequence: "1",
    });
    expect(stored.has(key)).toBeTruthy();
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

  it("batches a large projection and refreshes inventory generations without advancing versions", async () => {
    const mailboxId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    let queries = 0;
    const bulkRepository = new SyncRepository(
      drizzle({
        client: connection,
        logger: {
          logQuery: () => {
            queries += 1;
          },
        },
      }),
      async () => {
        await Promise.resolve();
      },
      (error) => {
        failures.push(error);
      }
    );
    const write = async (generation: string) => {
      await bulkRepository.transaction(mailboxId, async ({ put }) => {
        for (let index = 0; index < 1001; index += 1) {
          const id = `label-${index}`;
          put({
            data: { kind: "label", value: { id, name: id } },
            id,
            kind: "label",
            providerGeneration: generation,
          });
        }
        await Promise.resolve();
      });
    };
    await write("first");
    expect(queries).toBeLessThan(20);
    const head = await bulkRepository.head(mailboxId);
    await write("second");
    await expect(bulkRepository.head(mailboxId)).resolves.toStrictEqual(head);
    const rows =
      await connection`SELECT DISTINCT "providerGeneration", version FROM "mailSyncEntity" WHERE "mailboxId"=${mailboxId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerGeneration: "second",
      version: "1",
    });
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
    await expect(commands.process(mailboxId)).resolves.toBeFalsy();
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

  it("commits feedback and every mailbox stream atomically without crossing organization boundaries", async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id, "organizationId") VALUES (${first}, 'first-team'), (${second}, 'second-team')`;
    await connection`INSERT INTO "managedMailMessage" (id, "mailboxId", "providerMessageId", "threadId", direction, "mailboxState") VALUES (${first}, ${first}, 'provider', 'thread', 'outbound', 'active'), (${second}, ${second}, 'provider', 'thread', 'outbound', 'trash')`;
    await connection`INSERT INTO "organizationMailDeliveryRecipient" ("organizationId", "providerMessageId", recipient, status, "lastEventAt", "updatedAt") VALUES ('first-team', 'provider', 'first@example.test', 'sent', now(), now()), ('second-team', 'provider', 'second@example.test', 'bounced', now(), now())`;
    await expect(
      repository.transactionMany(
        [first, second],
        async (_database, contexts) => {
          for (const context of contexts.values()) {
            await projectManagedDelivery(context, [context.mailboxId]);
          }
          throw new Error("Interrupted transaction");
        }
      )
    ).rejects.toThrow("Interrupted transaction");
    await expect(repository.head(first)).resolves.toBeNull();
    await expect(repository.head(second)).resolves.toBeNull();
    let deliveries = 0;
    deliver = async () => {
      deliveries += 1;
      const rows =
        await connection`SELECT "mailboxId" FROM "mailSyncChange" WHERE "mailboxId" IN (${first}, ${second})`;
      expect(rows).toHaveLength(2);
    };
    await repository.transactionMany(
      [second, first],
      async (_database, contexts) => {
        for (const context of contexts.values()) {
          await projectManagedDelivery(context, [context.mailboxId]);
        }
      }
    );
    expect(deliveries).toBe(2);
    const rows =
      await connection`SELECT "mailboxId", data FROM "mailSyncEntity" WHERE "mailboxId" IN (${first}, ${second})`;
    expect(rows.find((row) => row.mailboxId === first)).toMatchObject({
      data: {
        value: {
          recipients: [{ recipient: "first@example.test", status: "sent" }],
        },
      },
    });
    expect(rows.find((row) => row.mailboxId === second)).toMatchObject({
      data: {
        value: {
          recipients: [{ recipient: "second@example.test", status: "bounced" }],
        },
      },
    });
  });

  it("records intent before an external send and makes concurrent retries observe it", async () => {
    const mailboxId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    await connection`INSERT INTO "user" (id) VALUES (${userId})`;
    const submissions = new SyncSubmissions(
      drizzle({ client: connection }),
      (error) => {
        failures.push(error);
      }
    );
    const input = {
      kind: "send" as const,
      mailboxId,
      operationId: "send",
      payloadHash: "content",
      recoveryKey: "key",
      userId,
    };
    const receipt = { id: "sent-message", threadId: "thread" };
    const started = Promise.withResolvers<boolean>();
    const accepted = Promise.withResolvers<typeof receipt>();
    let calls = 0;
    const provider = {
      execute: async () => {
        calls += 1;
        const rows =
          await connection`SELECT status FROM "mailSyncSubmission" WHERE "mailboxId"=${mailboxId}`;
        expect(rows[0]?.status).toBe("unknown");
        started.resolve(true);
        return await accepted.promise;
      },
      isRejected: () => false,
      reconcile: async () => {
        await Promise.resolve();
        return null;
      },
    };
    const original = submissions.run(input, provider);
    await started.promise;
    await expect(submissions.run(input, provider)).rejects.toThrow(
      "must be confirmed"
    );
    accepted.resolve(receipt);
    await expect(original).resolves.toStrictEqual(receipt);
    await expect(submissions.run(input, provider)).resolves.toStrictEqual(
      receipt
    );
    await expect(
      submissions.run({ ...input, payloadHash: "changed" }, provider)
    ).rejects.toThrow("different content");
    await expect(
      submissions.run({ ...input, userId: "someone-else" }, provider)
    ).rejects.toThrow("different content");
    expect(calls).toBe(1);
  });

  it("recovers an unknown send without repeating it and permits retry after a definite rejection", async () => {
    const mailboxId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await connection`INSERT INTO mailbox (id) VALUES (${mailboxId})`;
    await connection`INSERT INTO "user" (id) VALUES (${userId})`;
    const submissions = new SyncSubmissions(
      drizzle({ client: connection }),
      (error) => {
        failures.push(error);
      }
    );
    const input = {
      kind: "send" as const,
      mailboxId,
      operationId: "send",
      payloadHash: "content",
      recoveryKey: "key",
      userId,
    };
    const receipt = { id: "sent-message", threadId: "thread" };
    let calls = 0;
    let found = false;
    let rejected = false;
    const provider = {
      execute: async () => {
        calls += 1;
        await Promise.resolve();
        throw new Error("Response lost");
      },
      isRejected: () => rejected,
      reconcile: async () => {
        await Promise.resolve();
        return found ? receipt : null;
      },
    };
    await expect(submissions.run(input, provider)).rejects.toThrow(
      "must be confirmed"
    );
    await expect(submissions.run(input, provider)).rejects.toThrow(
      "must be confirmed"
    );
    found = true;
    await expect(submissions.run(input, provider)).resolves.toStrictEqual(
      receipt
    );
    expect(calls).toBe(1);
    rejected = true;
    const refused = { ...input, operationId: "refused" };
    await expect(submissions.run(refused, provider)).rejects.toThrow(
      "Response lost"
    );
    await expect(
      submissions.run(refused, {
        ...provider,
        execute: async () => {
          calls += 1;
          await Promise.resolve();
          return receipt;
        },
      })
    ).resolves.toStrictEqual(receipt);
    expect(calls).toBe(3);
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
      has: async (key: string) => {
        await Promise.resolve();
        return stored.has(key);
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
