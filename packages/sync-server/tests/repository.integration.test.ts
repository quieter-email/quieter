import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { mailSyncStream } from "@quieter/database/schema";
import type { SyncBatch } from "@quieter/sync";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

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
    for (const migration of ["20260909092211_unknown_princess_powerful"]) {
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
});
