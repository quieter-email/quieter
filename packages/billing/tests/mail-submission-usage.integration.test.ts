import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "@quieter/database/client";
import { acceptMailSubmission } from "@quieter/database/mail-acceptance";
import {
  beginMailSendAttempt,
  recordMailSendOutcome,
} from "@quieter/database/mail-attempts";
import {
  billingCreditUsageEvent,
  billingSubscription,
  mailSendAttempt,
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
  organization,
  organizationMailUsageSettings,
  user,
} from "@quieter/database/schema";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { assertLocalDatabaseUrl } from "../../database/scripts/local-development.ts";
import { reserveMailSubmissionUsage } from "../src/mail-submission-usage.ts";
import { getPolarClient } from "../src/polar.ts";

vi.mock(import("../src/polar.ts"), () => ({
  getPolarClient: vi.fn<typeof getPolarClient>(() => {
    throw new Error("Unexpected remote billing call.");
  }),
}));

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(databaseUrl === undefined)("transactional mail budgets", () => {
  let database: DatabaseClient;
  let connection: ReturnType<typeof postgres>;
  let fixtureLock: Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>>;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const now = new Date();
  const periodStart = new Date(now.getTime() - 86_400_000);
  const periodEnd = new Date(now.getTime() + 86_400_000);
  const credit = 1_000_000_000;

  const accept = async (idempotencyKey = randomUUID()) =>
    await acceptMailSubmission(database, {
      async assertAuthorization(transaction) {
        await transaction.execute(sql`select 1`);
      },
      attachmentBytes: 0,
      idempotencyKey,
      mailboxId: null,
      messageBytes: 10,
      organizationId,
      payload: {
        attachments: [],
        bcc: [],
        cc: [],
        from: "sender@example.com",
        headers: [],
        html: null,
        messageHeaderId: "<fixture@example.com>",
        metadata: {},
        openTracking: false,
        preparedAt: now.toISOString(),
        replyTo: [],
        subject: "fixture",
        tags: [],
        text: "test",
        to: ["recipient@example.com"],
        transportHtml: null,
      },
      recipientCount: 1,
      requestHash: "c".repeat(64),
      async reserveBudget(transaction) {
        return await reserveMailSubmissionUsage(transaction, {
          organizationId,
          sesCostMicroCents: 50,
        });
      },
    });

  beforeAll(async () => {
    assertLocalDatabaseUrl(databaseUrl ?? "", "quieter_migration_test");
    connection = postgres(databaseUrl ?? "", { max: 4 });
    fixtureLock = await connection.reserve();
    // Dispatchers scan across organizations; isolate suites sharing this disposable database.
    await fixtureLock`select pg_advisory_lock(26920260906)`;
    database = drizzle({ client: connection });
    await database.insert(user).values({
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "Budget fixture",
      updatedAt: now,
    });
    await database.insert(organization).values({
      billingOwnerUserId: userId,
      createdAt: now,
      id: organizationId,
      name: "Budget fixture",
      slug: organizationId,
    });
    await database.insert(billingSubscription).values({
      createdAt: now,
      currentPeriodEnd: periodEnd,
      currentPeriodStart: periodStart,
      id: randomUUID(),
      metadata: { quieterOrganizationId: organizationId },
      organizationId,
      plan: "managed",
      provider: "polar",
      providerProductId: "fixture",
      providerSubscriptionId: randomUUID(),
      status: "active",
      updatedAt: now,
      userId,
    });
    await database.insert(organizationMailUsageSettings).values({
      createdAt: now,
      organizationId,
      overageEnabled: false,
      updatedAt: now,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await database
      .delete(mailUsageReservation)
      .where(eq(mailUsageReservation.organizationId, organizationId));
    await database
      .delete(mailSendAttempt)
      .where(eq(mailSendAttempt.organizationId, organizationId));
    await database
      .delete(mailSubmissionOutbox)
      .where(eq(mailSubmissionOutbox.organizationId, organizationId));
    await database
      .delete(mailSubmission)
      .where(eq(mailSubmission.organizationId, organizationId));
    await database
      .delete(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.organizationId, organizationId));
    await database
      .update(billingSubscription)
      .set({ updatedAt: new Date() })
      .where(eq(billingSubscription.organizationId, organizationId));
    await database
      .update(organizationMailUsageSettings)
      .set({ monthlyOverageLimitMicroCents: null, overageEnabled: false })
      .where(eq(organizationMailUsageSettings.organizationId, organizationId));
    await database.insert(billingCreditUsageEvent).values({
      billableCostMicroCents: 0,
      category: "ai",
      costMicroCents: credit - 100,
      createdAt: now,
      dedupeKey: randomUUID(),
      id: randomUUID(),
      organizationId,
    });
  });

  afterAll(async () => {
    if (connection === undefined) {
      return;
    }
    try {
      await database
        .delete(mailUsageReservation)
        .where(eq(mailUsageReservation.organizationId, organizationId));
      await database
        .delete(mailSendAttempt)
        .where(eq(mailSendAttempt.organizationId, organizationId));
      await database
        .delete(mailSubmissionOutbox)
        .where(eq(mailSubmissionOutbox.organizationId, organizationId));
      await database
        .delete(mailSubmission)
        .where(eq(mailSubmission.organizationId, organizationId));
      await database
        .delete(organization)
        .where(eq(organization.id, organizationId));
      await database.delete(user).where(eq(user.id, userId));
    } finally {
      await fixtureLock`select pg_advisory_unlock(26920260906)`;
      fixtureLock.release();
      await connection.end();
    }
  });

  it("reserves the last included credit once across concurrent submissions", async () => {
    const results = await Promise.allSettled([accept(), accept()]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const rows = await database
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.organizationId, organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      billableCostMicroCents: 0,
      creditAmountMicroCents: credit,
      includedCostMicroCents: 100,
    });
    expect(getPolarClient).not.toHaveBeenCalled();
  });

  it("replays without reserving again and releases credit after definitive rejection", async () => {
    const key = randomUUID();
    const first = await accept(key);
    await expect(accept(key)).resolves.toStrictEqual({
      replayed: true,
      result: first.result,
    });
    const attempt = await beginMailSendAttempt(database, {
      async assertPolicy(transaction) {
        await transaction.execute(sql`select 1`);
      },
      organizationId,
      owner: "fixture",
      region: "eu-central-1",
      submissionId: first.result.messageId,
    });
    expect(attempt).not.toBeNull();
    if (attempt === null) {
      throw new Error("Missing attempt.");
    }
    await recordMailSendOutcome(database, attempt, {
      code: "message_rejected",
      outcome: "rejected",
    });
    const replacement = await accept();
    expect(replacement.replayed).toBeFalsy();
  });

  it("preserves the budget while provider acceptance is unknown", async () => {
    const first = await accept();
    const attempt = await beginMailSendAttempt(database, {
      async assertPolicy(transaction) {
        await transaction.execute(sql`select 1`);
      },
      organizationId,
      owner: "fixture",
      region: "eu-central-1",
      submissionId: first.result.messageId,
    });
    if (attempt === null) {
      throw new Error("Missing attempt.");
    }
    await recordMailSendOutcome(database, attempt, {
      code: "timeout",
      outcome: "unknown",
    });
    await expect(accept()).rejects.toThrow("usage limit");
  });

  it("enforces the overage cap including other pending reservations", async () => {
    await database
      .update(organizationMailUsageSettings)
      .set({ monthlyOverageLimitMicroCents: 100, overageEnabled: true })
      .where(eq(organizationMailUsageSettings.organizationId, organizationId));
    await accept();
    await accept();
    await expect(accept()).rejects.toThrow("usage limit");
  });

  it("fails stale entitlements without performing remote work or accepting a submission", async () => {
    await database
      .update(billingSubscription)
      .set({ updatedAt: new Date(now.getTime() - 600_000) })
      .where(eq(billingSubscription.organizationId, organizationId));
    await expect(accept()).rejects.toThrow("Could not check billing access");
    await expect(
      database
        .select()
        .from(mailSubmission)
        .where(eq(mailSubmission.organizationId, organizationId))
    ).resolves.toHaveLength(0);
    expect(getPolarClient).not.toHaveBeenCalled();
  });
});
