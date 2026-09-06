/// <reference types="node" />
import { randomUUID } from "node:crypto";

import type { getOrganizationSubscriptionRecord } from "@quieter/billing/entitlements";
import { reserveMailSubmissionUsage } from "@quieter/billing/mail-submission-usage";
import type { DatabaseClient } from "@quieter/database/client";
import { assertLocalDatabaseUrl } from "@quieter/database/local-development";
import { acceptMailSubmission } from "@quieter/database/mail-acceptance";
import { recordMailSendOutcome } from "@quieter/database/mail-attempts";
import { retainMailFeedback } from "@quieter/database/mail-feedback-inbox";
import { storeMailSendCapacity } from "@quieter/database/mail-send-capacity";
import {
  billingCreditUsageEvent,
  billingSubscription,
  mailDomain,
  mailFeedbackInbox,
  mailPayloadUpload,
  mailSendAttempt,
  mailSendCapacity,
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
  organization,
  organizationMailDeliveryEvent,
  organizationMailDeliveryRecipient,
  user,
} from "@quieter/database/schema";
import type {
  PreparedSubmission,
  SubmissionTransportResult,
} from "@quieter/mail/submission-transport";
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

import { applyMailSubmissionFeedback } from "../src/mail-submission-feedback.ts";
import { prepareMailSubmissionPayload } from "../src/mail-submission-payload.ts";
import type { SubmissionPayloadStorage } from "../src/mail-submission-payload.ts";
import { dispatchMailSubmission } from "../src/mail-submission-sender.ts";

vi.mock(import("@quieter/billing/entitlements"), async (importOriginal) => ({
  ...(await importOriginal()),
  getOrganizationSubscriptionRecord: vi
    .fn<typeof getOrganizationSubscriptionRecord>()
    .mockResolvedValue(null),
}));

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(databaseUrl === undefined)("durable submission sender", () => {
  let database: DatabaseClient;
  let connection: ReturnType<typeof postgres>;
  let fixtureLock: Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>>;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const domain = `${organizationId}.example.com`;
  const capacityKey = "000000000270:eu-central-1";
  const expectedSource = "arn:aws:sns:eu-central-1:000000000270:feedback";
  const now = new Date();
  const objects = new Map<string, Uint8Array>();
  const send =
    vi.fn<
      (message: PreparedSubmission) => Promise<SubmissionTransportResult>
    >();
  const storage: SubmissionPayloadStorage = {
    // oxlint-disable-next-line require-await -- In-memory storage preserves the asynchronous adapter contract.
    async read(object) {
      const bytes = objects.get(object.key);
      if (bytes === undefined) {
        throw new Error("Missing fixture.");
      }
      return bytes;
    },
    // oxlint-disable-next-line require-await -- In-memory storage preserves the asynchronous adapter contract.
    async remove(key) {
      objects.delete(key);
    },
    // oxlint-disable-next-line require-await -- In-memory storage preserves the asynchronous adapter contract.
    async write(object, bytes) {
      objects.set(object.key, bytes);
    },
  };
  const accept = async () => {
    const prepared = await prepareMailSubmissionPayload(database, {
      message: {
        attachments: [{ content: "Zml4dHVyZQ==", filename: "fixture.txt" }],
        from: `sender@${domain}`,
        subject: "fixture",
        text: "fixture",
        to: ["reader@example.com"],
      },
      openTracking: false,
      organizationId,
      storage,
    });
    const accepted = await acceptMailSubmission(database, {
      ...prepared,
      async assertAuthorization(transaction) {
        await transaction.execute(sql`select 1`);
      },
      idempotencyKey: randomUUID(),
      mailboxId: null,
      organizationId,
      requestHash: "a".repeat(64),
      async reserveBudget(transaction) {
        return await reserveMailSubmissionUsage(transaction, {
          organizationId,
          sesCostMicroCents: 10_000,
        });
      },
    });
    return accepted.result.messageId;
  };
  const dispatch = async (submissionId: string) =>
    await dispatchMailSubmission(database, {
      capacityKey,
      organizationId,
      owner: "sender-fixture",
      region: "eu-central-1",
      send,
      storage,
      submissionId,
    });
  const clearLedger = async () => {
    await database
      .delete(mailFeedbackInbox)
      .where(eq(mailFeedbackInbox.source, expectedSource));
    await database
      .delete(organizationMailDeliveryEvent)
      .where(eq(organizationMailDeliveryEvent.organizationId, organizationId));
    await database
      .delete(organizationMailDeliveryRecipient)
      .where(
        eq(organizationMailDeliveryRecipient.organizationId, organizationId)
      );
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
      .delete(mailPayloadUpload)
      .where(eq(mailPayloadUpload.organizationId, organizationId));
    await database
      .delete(mailSendCapacity)
      .where(eq(mailSendCapacity.key, capacityKey));
    await database
      .delete(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.organizationId, organizationId));
  };

  const retainFeedback = async (
    message: PreparedSubmission,
    providerMessageId: string,
    schemaVersion = 1
  ) => {
    const eventId = randomUUID();
    const timestamp = new Date().toISOString();
    return await retainMailFeedback(database, {
      payload: {
        Message: JSON.stringify({
          delivery: { recipients: message.to, timestamp },
          eventType: "Delivery",
          mail: {
            destination: [...message.to, ...message.cc, ...message.bcc],
            messageId: providerMessageId,
            source: message.from,
            tags: {
              quieter_attempt: [message.attemptId],
              quieter_submission: [message.submissionId],
            },
            timestamp,
          },
        }),
        MessageId: eventId,
        TopicArn: expectedSource,
        Type: "Notification",
      },
      providerEventId: eventId,
      providerMessageId,
      region: "eu-central-1",
      schemaVersion,
      source: expectedSource,
    });
  };

  beforeAll(async () => {
    assertLocalDatabaseUrl(databaseUrl ?? "", "quieter_migration_test");
    connection = postgres(databaseUrl ?? "", { max: 4 });
    fixtureLock = await connection.reserve();
    await fixtureLock`select pg_advisory_lock(26920260906)`;
    database = drizzle({ client: connection });
    await database.insert(user).values({
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "Sender fixture",
      updatedAt: now,
    });
    await database.insert(organization).values({
      billingOwnerUserId: userId,
      createdAt: now,
      id: organizationId,
      name: "Sender fixture",
      slug: organizationId,
    });
    await database.insert(billingSubscription).values({
      createdAt: now,
      currentPeriodEnd: new Date(now.getTime() + 86_400_000),
      currentPeriodStart: new Date(now.getTime() - 86_400_000),
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
    await database.insert(mailDomain).values({
      createdAt: now,
      domain,
      id: randomUUID(),
      mailFromDomain: `mail.${domain}`,
      organizationId,
      requiredDnsRecords: [],
      status: "verified",
      updatedAt: now,
    });
  });
  beforeEach(async () => {
    await clearLedger();
    objects.clear();
    send.mockReset().mockResolvedValue({
      outcome: "accepted",
      providerMessageId: randomUUID(),
    });
    await database
      .update(mailDomain)
      .set({ status: "verified" })
      .where(eq(mailDomain.organizationId, organizationId));
    await database
      .update(billingSubscription)
      .set({ updatedAt: new Date() })
      .where(eq(billingSubscription.organizationId, organizationId));
    await storeMailSendCapacity(database, {
      accountId: "000000000270",
      max24HourSend: 100,
      maxSendRate: 100,
      observedAt: new Date(),
      region: "eu-central-1",
      sendingEnabled: true,
      sentLast24Hours: 0,
    });
  });

  afterAll(async () => {
    if (connection === undefined) {
      return;
    }
    try {
      await clearLedger();
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

  it("sends one prepared message across concurrent queue deliveries and settles usage once", async () => {
    const id = await accept();
    const results = await Promise.all([dispatch(id), dispatch(id)]);
    expect(new Set(results)).toStrictEqual(new Set(["accepted", "inactive"]));
    expect(send).toHaveBeenCalledOnce();
    const [attempt] = await database
      .select()
      .from(mailSendAttempt)
      .where(eq(mailSendAttempt.submissionId, id));
    expect(attempt).toMatchObject({
      capacityKey,
      outcome: "accepted",
      recipientCount: 1,
    });
    const rows = await database
      .select()
      .from(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.organizationId, organizationId));
    expect(rows).toHaveLength(1);
    expect(send.mock.calls[0][0].raw).toContain('filename="fixture.txt"');
  });

  it("retains an unknown transport outcome without resending on queue redelivery", async () => {
    const id = await accept();
    send.mockRejectedValue(new Error("Response lost after send."));
    await expect(dispatch(id)).resolves.toBe("pending_confirmation");
    await expect(dispatch(id)).resolves.toBe("inactive");
    expect(send).toHaveBeenCalledOnce();
    const [reservation] = await database
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.submissionId, id));
    expect(reservation.status).toBe("reserved");
  });

  it("rechecks sender ownership before the provider call and releases a policy rejection", async () => {
    const id = await accept();
    await database
      .update(mailDomain)
      .set({ status: "pending_dns" })
      .where(eq(mailDomain.organizationId, organizationId));
    await expect(dispatch(id)).resolves.toBe("failed");
    expect(send).not.toHaveBeenCalled();
    const [reservation] = await database
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.submissionId, id));
    expect(reservation.status).toBe("released");
    const attempts = await database
      .select()
      .from(mailSendAttempt)
      .where(eq(mailSendAttempt.submissionId, id));
    expect(attempts).toHaveLength(0);
  });

  it("defers stale capacity durably before creating an attempt", async () => {
    const id = await accept();
    await database
      .update(mailSendCapacity)
      .set({ observedAt: new Date(Date.now() - 61_000) })
      .where(eq(mailSendCapacity.key, capacityKey));
    await expect(dispatch(id)).resolves.toBe("queued");
    expect(send).not.toHaveBeenCalled();
    const [submission] = await database
      .select()
      .from(mailSubmission)
      .where(eq(mailSubmission.id, id));
    expect(submission).toMatchObject({
      dispatchGeneration: 0,
      failureCode: "provider_capacity_stale",
      status: "queued",
    });
    expect(submission.sendAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("applies feedback before the sender response and keeps the stronger confirmation", async () => {
    const id = await accept();
    const providerMessageId = randomUUID();
    send.mockImplementationOnce(async (message) => {
      const retained = await retainFeedback(message, providerMessageId);
      await applyMailSubmissionFeedback(database, {
        expectedSource,
        inboxId: retained.id,
        region: "eu-central-1",
      });
      return { code: "provider_outcome_unknown", outcome: "unknown" };
    });
    await expect(dispatch(id)).resolves.toBe("accepted");
    const [event] = await database
      .select()
      .from(organizationMailDeliveryEvent)
      .where(eq(organizationMailDeliveryEvent.organizationId, organizationId));
    expect(event.eventType).toBe("delivered");
    const [inbox] = await database
      .select()
      .from(mailFeedbackInbox)
      .where(eq(mailFeedbackInbox.source, expectedSource));
    expect(inbox.status).toBe("applied");
    expect(send).toHaveBeenCalledOnce();
  });

  it("rolls back feedback and settlement together and retries without duplicate delivery events", async () => {
    const id = await accept();
    send.mockResolvedValue({ code: "timeout", outcome: "unknown" });
    await dispatch(id);
    const retained = await retainFeedback(send.mock.calls[0][0], randomUUID());
    await database.insert(billingCreditUsageEvent).values({
      billableCostMicroCents: 0,
      category: "mail",
      costMicroCents: 0,
      createdAt: new Date(),
      dedupeKey: `mail:submission:${id}`,
      id: randomUUID(),
      organizationId,
    });
    await expect(
      applyMailSubmissionFeedback(database, {
        expectedSource,
        inboxId: retained.id,
        region: "eu-central-1",
      })
    ).rejects.toThrow("Failed query");
    const [pending] = await database
      .select()
      .from(mailFeedbackInbox)
      .where(eq(mailFeedbackInbox.id, retained.id));
    expect(pending.status).toBe("pending");
    await database
      .delete(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.organizationId, organizationId));
    await applyMailSubmissionFeedback(database, {
      expectedSource,
      inboxId: retained.id,
      region: "eu-central-1",
    });
    await applyMailSubmissionFeedback(database, {
      expectedSource,
      inboxId: retained.id,
      region: "eu-central-1",
    });
    await expect(
      database
        .select()
        .from(organizationMailDeliveryEvent)
        .where(eq(organizationMailDeliveryEvent.organizationId, organizationId))
    ).resolves.toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it("quarantines a correlation that names a different sender", async () => {
    const id = await accept();
    send.mockResolvedValue({ code: "timeout", outcome: "unknown" });
    await dispatch(id);
    const retained = await retainFeedback(
      { ...send.mock.calls[0][0], from: "attacker@example.com" },
      randomUUID()
    );
    await expect(
      applyMailSubmissionFeedback(database, {
        expectedSource,
        inboxId: retained.id,
        region: "eu-central-1",
      })
    ).resolves.toBe("quarantined");
    const [attempt] = await database
      .select()
      .from(mailSendAttempt)
      .where(eq(mailSendAttempt.submissionId, id));
    expect(attempt.outcome).toBe("unknown");
    await expect(
      database
        .select()
        .from(organizationMailDeliveryEvent)
        .where(eq(organizationMailDeliveryEvent.organizationId, organizationId))
    ).resolves.toHaveLength(0);
  });

  it("retains unsupported feedback schemas in quarantine", async () => {
    const id = await accept();
    send.mockResolvedValue({ code: "timeout", outcome: "unknown" });
    await dispatch(id);
    const retained = await retainFeedback(
      send.mock.calls[0][0],
      randomUUID(),
      2
    );
    await expect(
      applyMailSubmissionFeedback(database, {
        expectedSource,
        inboxId: retained.id,
        region: "eu-central-1",
      })
    ).resolves.toBe("quarantined");
    const [inbox] = await database
      .select()
      .from(mailFeedbackInbox)
      .where(eq(mailFeedbackInbox.id, retained.id));
    expect(inbox).toMatchObject({
      lastErrorCode: "feedback_schema_or_digest_invalid",
      processedAt: null,
      status: "quarantined",
    });
    expect(inbox.payload).toHaveProperty("Message");
  });

  it("bounds safe retries for explicit throttling rejections", async () => {
    const id = await accept();
    send.mockResolvedValue({
      code: "provider_throttled",
      outcome: "rejected",
      retryable: true,
    });
    const results: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Exercise sequential queue redelivery after each durable retry deadline.
      await database
        .update(mailSubmission)
        .set({ sendAfter: sql`now() - interval '1 second'` })
        .where(eq(mailSubmission.id, id));
      // oxlint-disable-next-line no-await-in-loop -- Make the test capacity clock eligible for this next delivery.
      await database
        .update(mailSendCapacity)
        .set({ nextSendAt: sql`now() - interval '1 second'` })
        .where(eq(mailSendCapacity.key, capacityKey));
      // oxlint-disable-next-line no-await-in-loop -- Each attempt must complete before testing its successor.
      results.push(await dispatch(id));
    }
    expect(results).toStrictEqual([
      "queued",
      "queued",
      "queued",
      "queued",
      "failed",
    ]);
    expect(send).toHaveBeenCalledTimes(5);
    const [reservation] = await database
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.submissionId, id));
    expect(reservation.status).toBe("released");
  });

  it("does not issue another send when confirmation persistence fails after provider acceptance", async () => {
    const id = await accept();
    const providerMessageId = randomUUID();
    send.mockImplementationOnce(async () => {
      await database.insert(billingCreditUsageEvent).values({
        billableCostMicroCents: 0,
        category: "mail",
        costMicroCents: 0,
        createdAt: new Date(),
        dedupeKey: `mail:submission:${id}`,
        id: randomUUID(),
        organizationId,
      });
      return { outcome: "accepted", providerMessageId };
    });
    await expect(dispatch(id)).rejects.toThrow("Failed query");
    await expect(dispatch(id)).resolves.toBe("inactive");
    const [attempt] = await database
      .select()
      .from(mailSendAttempt)
      .where(eq(mailSendAttempt.submissionId, id));
    expect(attempt.outcome).toBe("intent");
    await database
      .delete(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.organizationId, organizationId));
    await recordMailSendOutcome(database, attempt, {
      outcome: "accepted",
      providerMessageId,
    });
    const [reservation] = await database
      .select()
      .from(mailUsageReservation)
      .where(eq(mailUsageReservation.submissionId, id));
    expect(reservation.status).toBe("finalized");
    expect(send).toHaveBeenCalledOnce();
  });
});
