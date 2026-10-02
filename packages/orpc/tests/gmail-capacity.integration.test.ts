import { GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import type { BillingPlan } from "@quieter/billing/plans";
import type { DatabaseClient } from "@quieter/database/client";
import { sql } from "drizzle-orm";
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
  getGmailMailboxCapacity,
  withGmailMailboxCapacity,
} from "../src/mailbox/gmail-capacity";

const fixture = vi.hoisted(() => {
  const state: { database: DatabaseClient | null; plan: BillingPlan } = {
    database: null,
    plan: "free",
  };
  return state;
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Inject the isolated PostgreSQL schema into the application boundary.
vi.mock("@quieter/database/client", () => ({
  get db() {
    if (fixture.database === null) {
      throw new Error("Test database is not ready.");
    }
    return fixture.database;
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Billing fixtures do not contact Polar or change subscriptions.
vi.mock("@quieter/billing/entitlements", () => ({
  getOrganizationBillingEntitlement: async () => {
    await Promise.resolve();
    return { product: fixture.plan === "free" ? null : fixture.plan };
  },
}));

const databaseUrl =
  process.env.SYNC_TEST_DATABASE_URL ?? process.env.MIGRATION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite("Gmail team capacity", () => {
  const schema = `gmail_capacity_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof postgres>;
  let connection: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("A disposable database is required.");
    }
    const url = new URL(databaseUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["/quieter_sync_test", "/quieter_migration_test"].includes(url.pathname)
    ) {
      throw new Error(
        "Capacity tests require an explicitly named loopback test database."
      );
    }
    admin = postgres(databaseUrl, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    connection = postgres(databaseUrl, {
      connection: { search_path: schema },
      max: 3,
    });
    await connection.unsafe(`CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE member (id text PRIMARY KEY, "organizationId" text, "userId" text);
      CREATE TABLE mailbox (id text PRIMARY KEY, "organizationId" text, "ownerUserId" text, provider text);
      INSERT INTO organization VALUES ('team'), ('other');
      INSERT INTO member VALUES ('a','team','alice'), ('b','team','bob'), ('c','other','alice');`);
    fixture.database = drizzle({ client: connection });
  });
  beforeEach(async () => {
    fixture.plan = "free";
    await connection`DELETE FROM mailbox`;
  });

  afterAll(async () => {
    await connection?.end();
    if (admin !== undefined) {
      await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  test.each(["free", "managed", "pro"] as const)(
    "enforces the %s team limit",
    async (plan) => {
      fixture.plan = plan;
      const limit = GMAIL_MAILBOX_LIMITS[plan];
      await connection`INSERT INTO mailbox SELECT 'gmail-' || n, 'team', 'alice', 'gmail' FROM generate_series(1, ${limit}) n`;
      await expect(
        withGmailMailboxCapacity(
          { mailboxId: null, organizationId: "team", userId: "bob" },
          async () => {
            await Promise.resolve();
          }
        )
      ).rejects.toThrow(`limit of ${limit} Gmail accounts`);
      await expect(getGmailMailboxCapacity("team")).resolves.toStrictEqual({
        limit,
        used: limit,
      });
    }
  );

  test("serializes simultaneous connections by different team members", async () => {
    await connection`INSERT INTO mailbox SELECT 'gmail-' || n, 'team', 'alice', 'gmail' FROM generate_series(1,4) n`;
    const results = await Promise.allSettled(
      ["alice", "bob"].map(async (userId) => {
        await withGmailMailboxCapacity(
          { mailboxId: null, organizationId: "team", userId },
          async (database) => {
            await database.execute(
              sql`INSERT INTO mailbox VALUES (${userId}, 'team', ${userId}, 'gmail')`
            );
          }
        );
      })
    );
    expect(results.map((result) => result.status).toSorted()).toStrictEqual([
      "fulfilled",
      "rejected",
    ]);
    const capacity = await getGmailMailboxCapacity("team");
    expect(capacity.used).toBe(5);
  });

  test("allows reconnects after a downgrade and does not count managed mailboxes", async () => {
    await connection`INSERT INTO mailbox SELECT 'gmail-' || n, 'team', 'alice', 'gmail' FROM generate_series(1,6) n`;
    await connection`INSERT INTO mailbox VALUES ('managed', 'team', 'alice', 'managed')`;
    await expect(
      withGmailMailboxCapacity(
        { mailboxId: "gmail-1", organizationId: "team", userId: "alice" },
        async () => await Promise.resolve("reconnected")
      )
    ).resolves.toBe("reconnected");
    const capacity = await getGmailMailboxCapacity("team");
    expect(capacity.used).toBe(6);
  });

  test("rejects moving into a full team and cannot reconnect another owner's mailbox", async () => {
    await connection`INSERT INTO mailbox SELECT 'gmail-' || n, 'team', 'alice', 'gmail' FROM generate_series(1,5) n`;
    await connection`INSERT INTO mailbox VALUES ('moving', 'other', 'alice', 'gmail')`;
    await expect(
      withGmailMailboxCapacity(
        { mailboxId: "moving", organizationId: "team", userId: "alice" },
        async () => {
          await Promise.resolve();
        }
      )
    ).rejects.toThrow("limit of 5");
    await expect(
      withGmailMailboxCapacity(
        { mailboxId: "gmail-1", organizationId: "team", userId: "bob" },
        async () => {
          await Promise.resolve();
        }
      )
    ).rejects.toThrow("Gmail mailbox not found");
    await expect(
      withGmailMailboxCapacity(
        { mailboxId: null, organizationId: "team", userId: "stranger" },
        async () => {
          await Promise.resolve();
        }
      )
    ).rejects.toThrow("no longer have access");
  });

  test("rolls back the mailbox write when credential persistence fails", async () => {
    await expect(
      withGmailMailboxCapacity(
        { mailboxId: null, organizationId: "team", userId: "alice" },
        async (database) => {
          await database.execute(
            sql`INSERT INTO mailbox VALUES ('new', 'team', 'alice', 'gmail')`
          );
          throw new Error("Credential write failed");
        }
      )
    ).rejects.toThrow("Credential write failed");
    const capacity = await getGmailMailboxCapacity("team");
    expect(capacity.used).toBe(0);
  });
});
