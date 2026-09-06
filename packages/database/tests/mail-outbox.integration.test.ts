import { randomUUID } from "node:crypto";

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
} from "vite-plus/test";

import { assertLocalDatabaseUrl } from "../scripts/local-development.ts";
import type { DatabaseClient } from "../src/client.ts";
import { acceptMailSubmission } from "../src/mail-acceptance.ts";
import {
  beginMailSendAttempt,
  recordMailSendOutcome,
  recoverUnknownMailAttempts,
} from "../src/mail-attempts.ts";
import { retainMailFeedback } from "../src/mail-feedback-inbox.ts";
import {
  claimMailOutbox,
  completeMailOutbox,
  deferMailOutbox,
  dispatchMailOutbox,
  recoverQueuedMailOutbox,
} from "../src/mail-outbox.ts";
import {
  createMailPayloadUpload,
  completeMailPayloadUpload,
  cleanupMailPayloadUploads,
} from "../src/mail-payload-uploads.ts";
import { storeMailSendCapacity } from "../src/mail-send-capacity.ts";
import {
  findMailSubmissionReplay,
  readMailSubmissionStatus,
} from "../src/mail-submission-read.ts";
import {
  mailSendAttempt,
  billingCreditUsageEvent,
  mailFeedbackInbox,
  mailPayloadUpload,
  mailSendCapacity,
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
  organization,
  organizationMailUsageEvent,
} from "../src/schema.ts";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(databaseUrl === undefined)(
  "mail outbox on migrated PostgreSQL",
  () => {
    let database: DatabaseClient;
    let connection: ReturnType<typeof postgres>;
    let fixtureLock: Awaited<
      ReturnType<ReturnType<typeof postgres>["reserve"]>
    >;
    const organizationId = randomUUID();
    const capacityKey = "000000000269:eu-central-1";
    const now = new Date();

    const createSubmission = async () => {
      const id = randomUUID();
      await database.transaction(async (transaction) => {
        await transaction.insert(mailSubmission).values({
          acceptedAt: now,
          acceptedResult: { messageId: id, status: "queued" },
          attachmentBytes: 0,
          id,
          idempotencyKey: randomUUID(),
          idempotencyRetainUntil: new Date(now.getTime() + 8 * 86_400_000),
          messageBytes: 10,
          nextActionAt: now,
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
          payloadDigest: "a".repeat(64),
          recipientCount: 1,
          requestHash: "b".repeat(64),
          updatedAt: now,
        });
        await transaction.insert(mailSubmissionOutbox).values({
          createdAt: now,
          dueAt: now,
          eventType: "submission.dispatch",
          id: randomUUID(),
          organizationId,
          submissionId: id,
        });
        await transaction.insert(mailUsageReservation).values({
          attachmentBytes: 0,
          billableCostMicroCents: 100,
          createdAt: now,
          includedCostMicroCents: 0,
          organizationId,
          periodEnd: new Date(now.getTime() + 86_400_000),
          periodStart: now,
          recipientCount: 1,
          sesCostMicroCents: 100,
          submissionId: id,
        });
      });
      return id;
    };

    beforeAll(async () => {
      assertLocalDatabaseUrl(databaseUrl ?? "", "quieter_migration_test");
      connection = postgres(databaseUrl ?? "", { max: 4 });
      fixtureLock = await connection.reserve();
      // Dispatchers scan across organizations; isolate suites sharing this disposable database.
      await fixtureLock`select pg_advisory_lock(26920260906)`;
      database = drizzle({ client: connection });
      await database.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Ledger fixture",
        slug: organizationId,
      });
    });
    beforeEach(async () => {
      await database
        .delete(billingCreditUsageEvent)
        .where(eq(billingCreditUsageEvent.organizationId, organizationId));
      await database
        .delete(organizationMailUsageEvent)
        .where(eq(organizationMailUsageEvent.organizationId, organizationId));
      await database
        .delete(mailFeedbackInbox)
        .where(eq(mailFeedbackInbox.source, organizationId));
      await database
        .delete(mailUsageReservation)
        .where(eq(mailUsageReservation.organizationId, organizationId));
      await database
        .delete(mailSendAttempt)
        .where(eq(mailSendAttempt.organizationId, organizationId));
      await database
        .delete(mailSendCapacity)
        .where(eq(mailSendCapacity.key, capacityKey));
      await database
        .delete(mailSubmissionOutbox)
        .where(eq(mailSubmissionOutbox.organizationId, organizationId));
      await database
        .delete(mailSubmission)
        .where(eq(mailSubmission.organizationId, organizationId));
      await database
        .delete(mailPayloadUpload)
        .where(eq(mailPayloadUpload.organizationId, organizationId));
    });

    afterAll(async () => {
      if (connection === undefined) {
        return;
      }
      try {
        await database
          .delete(mailFeedbackInbox)
          .where(eq(mailFeedbackInbox.source, organizationId));
        await database
          .delete(mailUsageReservation)
          .where(eq(mailUsageReservation.organizationId, organizationId));
        await database
          .delete(mailSendAttempt)
          .where(eq(mailSendAttempt.organizationId, organizationId));
        await database
          .delete(mailSendCapacity)
          .where(eq(mailSendCapacity.key, capacityKey));
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
          .delete(organization)
          .where(eq(organization.id, organizationId));
      } finally {
        await fixtureLock`select pg_advisory_unlock(26920260906)`;
        fixtureLock.release();
        await connection.end();
      }
    });

    it("shares recipient capacity across concurrent intents and keeps unknown sends reserved", async () => {
      const first = await createSubmission();
      const second = await createSubmission();
      await storeMailSendCapacity(database, {
        accountId: "000000000269",
        max24HourSend: 1,
        maxSendRate: 100,
        observedAt: new Date(),
        region: "eu-central-1",
        sendingEnabled: true,
        sentLast24Hours: 0,
      });
      const input = {
        async assertPolicy(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
        },
        capacityKey,
        organizationId,
        owner: "capacity-fixture",
        region: "eu-central-1",
      };
      const results = await Promise.allSettled([
        beginMailSendAttempt(database, { ...input, submissionId: first }),
        beginMailSendAttempt(database, { ...input, submissionId: second }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const [attempt] = await database
        .select()
        .from(mailSendAttempt)
        .where(eq(mailSendAttempt.organizationId, organizationId));
      const other = attempt.submissionId === first ? second : first;
      await recordMailSendOutcome(database, attempt, {
        code: "timeout",
        outcome: "unknown",
      });
      await database
        .update(mailSendCapacity)
        .set({ nextSendAt: sql`now() - interval '1 second'` })
        .where(eq(mailSendCapacity.key, capacityKey));
      await expect(
        beginMailSendAttempt(database, { ...input, submissionId: other })
      ).rejects.toThrow("capacity is temporarily unavailable");
      await recordMailSendOutcome(database, attempt, {
        code: "provider_rejected",
        outcome: "rejected",
      });
      const replacement = await beginMailSendAttempt(database, {
        ...input,
        submissionId: other,
      });
      expect(replacement?.recipientCount).toBe(1);
    });

    it("leaves queued work without a send intent when the regional capacity snapshot expires", async () => {
      const submissionId = await createSubmission();
      await storeMailSendCapacity(database, {
        accountId: "000000000269",
        max24HourSend: 10,
        maxSendRate: 10,
        observedAt: new Date(Date.now() - 61_000),
        region: "eu-central-1",
        sendingEnabled: true,
        sentLast24Hours: 0,
      });
      await expect(
        beginMailSendAttempt(database, {
          async assertPolicy(transaction) {
            await transaction.execute(sql`select 1`);
          },
          capacityKey,
          organizationId,
          owner: "capacity-fixture",
          region: "eu-central-1",
          submissionId,
        })
      ).rejects.toThrow("capacity is temporarily unavailable");
      const [submission] = await database
        .select()
        .from(mailSubmission)
        .where(eq(mailSubmission.id, submissionId));
      expect(submission).toMatchObject({
        dispatchGeneration: 0,
        status: "queued",
      });
      await expect(
        database
          .select()
          .from(mailSendAttempt)
          .where(eq(mailSendAttempt.organizationId, organizationId))
      ).resolves.toHaveLength(0);
    });

    it("claims prepared attachments atomically and keeps committed objects out of cleanup", async () => {
      const seedId = await createSubmission();
      const [seed] = await database
        .select()
        .from(mailSubmission)
        .where(eq(mailSubmission.id, seedId));
      const upload = await createMailPayloadUpload(database, {
        objects: [{ bytes: 3, digest: "a".repeat(64) }],
        organizationId,
      });
      await expect(
        completeMailPayloadUpload(database, {
          id: upload.id,
          organizationId: randomUUID(),
        })
      ).rejects.toThrow("expired or was fenced");
      await completeMailPayloadUpload(database, {
        id: upload.id,
        organizationId,
      });
      const input = {
        ...seed,
        async assertAuthorization(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
        },
        attachmentBytes: 3,
        idempotencyKey: randomUUID(),
        payload: {
          ...seed.payload,
          attachments: [
            {
              ...upload.objects[0],
              contentId: null,
              contentType: "text/plain",
              disposition: "attachment" as const,
              filename: "fixture.txt",
            },
          ],
        },
        payloadUploadId: upload.id,
        async reserveBudget(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
          return {
            billableCostMicroCents: 100,
            includedCostMicroCents: 0,
            periodEnd: new Date(now.getTime() + 86_400_000),
            periodStart: now,
            sesCostMicroCents: 50,
          };
        },
      };
      await expect(
        acceptMailSubmission(database, {
          ...input,
          payload: {
            ...input.payload,
            attachments: [
              { ...input.payload.attachments[0], digest: "c".repeat(64) },
            ],
          },
        })
      ).rejects.toThrow("does not match");
      await acceptMailSubmission(database, input);
      await database
        .update(mailPayloadUpload)
        .set({
          createdAt: sql`now() - interval '1 hour'`,
          expiresAt: sql`now() - interval '1 minute'`,
          nextActionAt: sql`now() - interval '1 minute'`,
        })
        .where(eq(mailPayloadUpload.id, upload.id));
      const cleanup = await cleanupMailPayloadUploads(database, {
        limit: 10,
        // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
        async remove() {
          throw new Error("Committed objects cannot be removed.");
        },
      });
      expect(cleanup).toStrictEqual({ claimed: 0, cleaned: 0 });
      await expect(
        acceptMailSubmission(database, {
          ...input,
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow("expired, unowned");
    });

    it("fences expired uploads and revisits failed and late object writes", async () => {
      const upload = await createMailPayloadUpload(database, {
        objects: [{ bytes: 3, digest: "a".repeat(64) }],
        organizationId,
      });
      await database
        .update(mailPayloadUpload)
        .set({
          createdAt: sql`now() - interval '1 hour'`,
          expiresAt: sql`now() - interval '1 minute'`,
          nextActionAt: sql`now() - interval '1 minute'`,
        })
        .where(eq(mailPayloadUpload.id, upload.id));
      await expect(
        cleanupMailPayloadUploads(database, {
          limit: 10,
          // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
          async remove() {
            throw new Error("Storage unavailable.");
          },
        })
      ).resolves.toStrictEqual({ claimed: 1, cleaned: 0 });
      await expect(
        completeMailPayloadUpload(database, { id: upload.id, organizationId })
      ).rejects.toThrow("expired or was fenced");
      await database
        .update(mailPayloadUpload)
        .set({ nextActionAt: sql`now() - interval '1 minute'` })
        .where(eq(mailPayloadUpload.id, upload.id));
      const removed: string[] = [];
      await expect(
        cleanupMailPayloadUploads(database, {
          limit: 10,
          // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
          async remove(key) {
            removed.push(key);
          },
        })
      ).resolves.toStrictEqual({ claimed: 1, cleaned: 1 });
      expect(removed).toStrictEqual([upload.objects[0].key]);
      await database
        .update(mailPayloadUpload)
        .set({ nextActionAt: sql`now() - interval '1 minute'` })
        .where(eq(mailPayloadUpload.id, upload.id));
      await cleanupMailPayloadUploads(database, {
        limit: 10,
        // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
        async remove(key) {
          removed.push(key);
        },
      });
      expect(removed).toHaveLength(2);
    });

    it("retains feedback before a provider mapping exists and deduplicates canonical content", async () => {
      const input = {
        payload: {
          detail: { event: "Delivery", message: "unmapped" },
          version: 1,
        },
        providerEventId: randomUUID(),
        providerMessageId: "unmapped",
        region: "eu-central-1",
        schemaVersion: 1,
        source: organizationId,
      };
      const original = await retainMailFeedback(database, input);
      const replay = await retainMailFeedback(database, {
        ...input,
        payload: Object.fromEntries<unknown>([
          ["version", 1],
          [
            "detail",
            Object.fromEntries([
              ["message", "unmapped"],
              ["event", "Delivery"],
            ]),
          ],
        ]),
      });
      expect(original.replayed).toBeFalsy();
      expect(replay).toStrictEqual({ id: original.id, replayed: true });
      const [row] = await database
        .select()
        .from(mailFeedbackInbox)
        .where(eq(mailFeedbackInbox.id, original.id));
      expect(row.status).toBe("pending");
      await expect(
        retainMailFeedback(database, {
          ...input,
          payload: { event: "changed" },
        })
      ).rejects.toThrow("conflicts");
    });

    /* oxlint-disable vitest/max-expects -- Verify the authorization and ownership boundary for both read contracts. */
    it("replays original acceptance separately from current status and checks authorization on every read", async () => {
      const messageId = await createSubmission();
      const [row] = await database
        .select({ idempotencyKey: mailSubmission.idempotencyKey })
        .from(mailSubmission)
        .where(eq(mailSubmission.id, messageId));
      const scope = {
        async assertAuthorization(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
        },
        mailboxId: null,
        organizationId,
      };
      await database
        .update(mailSubmission)
        .set({ status: "pending_confirmation" })
        .where(eq(mailSubmission.id, messageId));
      const replay = {
        ...scope,
        idempotencyKey: row.idempotencyKey,
        requestHash: "b".repeat(64),
      };
      await expect(
        findMailSubmissionReplay(database, replay)
      ).resolves.toStrictEqual({
        messageId,
        status: "queued",
      });
      await expect(
        readMailSubmissionStatus(database, { ...scope, messageId })
      ).resolves.toMatchObject({ messageId, status: "pending_confirmation" });
      await expect(
        readMailSubmissionStatus(database, {
          ...scope,
          mailboxId: randomUUID(),
          messageId,
        })
      ).resolves.toBeNull();
      await expect(
        readMailSubmissionStatus(database, {
          ...scope,
          messageId,
          organizationId: randomUUID(),
        })
      ).resolves.toBeNull();
      await expect(
        findMailSubmissionReplay(database, {
          ...replay,
          requestHash: "c".repeat(64),
        })
      ).rejects.toThrow("different message");
      await expect(
        findMailSubmissionReplay(database, {
          ...replay,
          mailboxId: randomUUID(),
        })
      ).rejects.toThrow("different message");
      const revoked = {
        // oxlint-disable-next-line require-await -- Simulate an authorization failure before any protected read.
        async assertAuthorization() {
          throw new Error("Authorization revoked.");
        },
      };
      await expect(
        findMailSubmissionReplay(database, { ...replay, ...revoked })
      ).rejects.toThrow("Authorization revoked");
      await expect(
        readMailSubmissionStatus(database, { ...scope, ...revoked, messageId })
      ).rejects.toThrow("Authorization revoked");
    });
    /* oxlint-enable vitest/max-expects */

    it("atomically accepts one submission and replays its original result under concurrent retries", async () => {
      const input = {
        async assertAuthorization(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
        },
        attachmentBytes: 0,
        idempotencyKey: randomUUID(),
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
        requestHash: "b".repeat(64),
        async reserveBudget(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
          return {
            billableCostMicroCents: 100,
            includedCostMicroCents: 0,
            periodEnd: new Date(now.getTime() + 86_400_000),
            periodStart: now,
            sesCostMicroCents: 100,
          };
        },
      };
      const results = await Promise.all([
        acceptMailSubmission(database, input),
        acceptMailSubmission(database, input),
      ]);
      expect(results.filter((result) => !result.replayed)).toHaveLength(1);
      expect(results[0].result).toStrictEqual(results[1].result);
      const reservations = await database
        .select()
        .from(mailUsageReservation)
        .where(eq(mailUsageReservation.organizationId, organizationId));
      expect(reservations).toHaveLength(1);
      await expect(
        acceptMailSubmission(database, {
          ...input,
          requestHash: "c".repeat(64),
        })
      ).rejects.toThrow("different message");
      const attempt = await beginMailSendAttempt(database, {
        async assertPolicy(transaction) {
          await transaction.execute(sql`select 1`);
        },
        organizationId,
        owner: "sender",
        region: "eu-central-1",
        submissionId: results[0].result.messageId,
      });
      expect(attempt).not.toBeNull();
    });

    it.each([
      { billable: -1, endOffset: 86_400_000, error: "Failed query" },
      { billable: 100, endOffset: -1000, error: "billing period changed" },
    ])(
      "rolls back acceptance for $error",
      async ({ billable, endOffset, error }) => {
        await expect(
          acceptMailSubmission(database, {
            async assertAuthorization(transaction) {
              await transaction.execute(sql`select 1`);
            },
            attachmentBytes: 0,
            idempotencyKey: randomUUID(),
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
            requestHash: "b".repeat(64),
            async reserveBudget(transaction) {
              await transaction.execute(sql`select 1`);
              return {
                billableCostMicroCents: billable,
                includedCostMicroCents: 0,
                periodEnd: new Date(now.getTime() + endOffset),
                periodStart: new Date(now.getTime() - 86_400_000),
                sesCostMicroCents: 100,
              };
            },
          })
        ).rejects.toThrow(error);
        const submissions = await database
          .select()
          .from(mailSubmission)
          .where(eq(mailSubmission.organizationId, organizationId));
        const events = await database
          .select()
          .from(mailSubmissionOutbox)
          .where(eq(mailSubmissionOutbox.organizationId, organizationId));
        expect(submissions).toHaveLength(0);
        expect(events).toHaveLength(0);
      }
    );

    it("records one send intent, preserves an unknown outcome, and settles late success once", async () => {
      const submissionId = await createSubmission();
      const input = {
        async assertPolicy(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, organizationId));
        },
        organizationId,
        owner: "sender",
        region: "eu-central-1",
        submissionId,
      };
      const claims = await Promise.all([
        beginMailSendAttempt(database, input),
        beginMailSendAttempt(database, input),
      ]);
      const attempts = claims.filter((attempt) => attempt !== null);
      expect(attempts).toHaveLength(1);
      const [attempt] = attempts;
      await database
        .update(mailSendAttempt)
        .set({ deadline: now, intentAt: new Date(now.getTime() - 120_000) })
        .where(eq(mailSendAttempt.id, attempt.id));
      await database
        .update(mailSubmission)
        .set({ nextActionAt: now })
        .where(eq(mailSubmission.id, submissionId));
      await expect(recoverUnknownMailAttempts(database)).resolves.toBe(1);
      await expect(beginMailSendAttempt(database, input)).resolves.toBeNull();
      const [reserved] = await database
        .select()
        .from(mailUsageReservation)
        .where(eq(mailUsageReservation.submissionId, submissionId));
      expect(reserved.status).toBe("reserved");
      await recordMailSendOutcome(database, attempt, {
        outcome: "accepted",
        providerMessageId: "ses-late-confirmation",
      });
      await expect(
        recordMailSendOutcome(database, attempt, {
          outcome: "accepted",
          providerMessageId: "ses-late-confirmation",
        })
      ).resolves.toBe("duplicate");
    });

    it("commits confirmed acceptance, one usage settlement, and its projection outbox together", async () => {
      const submissionId = await createSubmission();
      const attempt = await beginMailSendAttempt(database, {
        async assertPolicy(transaction) {
          await transaction.execute(sql`select 1`);
        },
        organizationId,
        owner: "sender",
        region: "eu-central-1",
        submissionId,
      });
      if (attempt === null) {
        throw new Error("Expected send attempt.");
      }
      await recordMailSendOutcome(database, attempt, {
        code: "transport_timeout",
        outcome: "unknown",
      });
      await recordMailSendOutcome(database, attempt, {
        outcome: "accepted",
        providerMessageId: "ses-confirmed",
      });
      const [submission] = await database
        .select()
        .from(mailSubmission)
        .where(eq(mailSubmission.id, submissionId));
      const [reservation] = await database
        .select()
        .from(mailUsageReservation)
        .where(eq(mailUsageReservation.submissionId, submissionId));
      const events = await database
        .select()
        .from(mailSubmissionOutbox)
        .where(eq(mailSubmissionOutbox.submissionId, submissionId));
      expect(submission.status).toBe("accepted");
      expect(submission.acceptedResult).toStrictEqual({
        messageId: submissionId,
        status: "queued",
      });
      expect(reservation.status).toBe("finalized");
      expect(events.map((event) => event.eventType).toSorted()).toStrictEqual([
        "submission.accepted",
        "submission.dispatch",
      ]);
      await expect(
        recordMailSendOutcome(database, attempt, {
          outcome: "accepted",
          providerMessageId: "different-message",
        })
      ).rejects.toThrow("conflicts");
    });

    it("holds reservations through safe retries and releases only a definitive terminal failure", async () => {
      const submissionId = await createSubmission();
      const input = {
        async assertPolicy(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
        },
        organizationId,
        owner: "sender",
        region: "eu-central-1",
        submissionId,
      };
      const first = await beginMailSendAttempt(database, input);
      if (first === null) {
        throw new Error("Expected send attempt.");
      }
      await recordMailSendOutcome(database, first, {
        code: "quota_rejected",
        outcome: "rejected",
        retryAt: now,
      });
      const [reserved] = await database
        .select()
        .from(mailUsageReservation)
        .where(eq(mailUsageReservation.submissionId, submissionId));
      expect(reserved.status).toBe("reserved");
      const next = await beginMailSendAttempt(database, input);
      if (next === null) {
        throw new Error("Expected safe retry attempt.");
      }
      expect(next.dispatchGeneration).toBe(first.dispatchGeneration + 1);
      await recordMailSendOutcome(database, next, {
        code: "policy_rejected",
        outcome: "rejected",
      });
      const [released] = await database
        .select()
        .from(mailUsageReservation)
        .where(eq(mailUsageReservation.submissionId, submissionId));
      expect(released.status).toBe("released");
      await expect(beginMailSendAttempt(database, input)).resolves.toBeNull();
    });

    it("rolls back a failed send-time policy check before creating provider intent", async () => {
      const submissionId = await createSubmission();
      await expect(
        beginMailSendAttempt(database, {
          async assertPolicy(transaction) {
            await transaction.execute(sql`select 1`);
            throw new Error("Sender no longer authorized");
          },
          organizationId,
          owner: "sender",
          region: "eu-central-1",
          submissionId,
        })
      ).rejects.toThrow("no longer authorized");
      const attempts = await database
        .select()
        .from(mailSendAttempt)
        .where(eq(mailSendAttempt.submissionId, submissionId));
      const [submission] = await database
        .select()
        .from(mailSubmission)
        .where(eq(mailSubmission.id, submissionId));
      expect(attempts).toHaveLength(0);
      expect(submission.status).toBe("queued");
    });

    it("does not charge overage for included credit held by an earlier failed reservation", async () => {
      const earlier = await createSubmission();
      const later = await createSubmission();
      await database
        .update(mailUsageReservation)
        .set({ creditAmountMicroCents: 100 })
        .where(eq(mailUsageReservation.organizationId, organizationId));
      const input = {
        async assertPolicy(
          transaction: Parameters<
            Parameters<DatabaseClient["transaction"]>[0]
          >[0]
        ) {
          await transaction.execute(sql`select 1`);
        },
        organizationId,
        owner: "sender",
        region: "eu-central-1",
      };
      const first = await beginMailSendAttempt(database, {
        ...input,
        submissionId: earlier,
      });
      const second = await beginMailSendAttempt(database, {
        ...input,
        submissionId: later,
      });
      if (first === null || second === null) {
        throw new Error("Expected both send attempts.");
      }
      await recordMailSendOutcome(database, first, {
        code: "policy_rejected",
        outcome: "rejected",
      });
      await recordMailSendOutcome(database, second, {
        outcome: "accepted",
        providerMessageId: "included-after-release",
      });
      await recordMailSendOutcome(database, second, {
        outcome: "accepted",
        providerMessageId: "included-after-release",
      });
      const events = await database
        .select({
          billable: billingCreditUsageEvent.billableCostMicroCents,
          cost: billingCreditUsageEvent.costMicroCents,
        })
        .from(billingCreditUsageEvent)
        .where(eq(billingCreditUsageEvent.organizationId, organizationId));
      expect(events).toStrictEqual([{ billable: 0, cost: 100 }]);
      const [settled] = await database
        .select()
        .from(mailUsageReservation)
        .where(eq(mailUsageReservation.submissionId, later));
      expect(settled.includedCostMicroCents).toBe(100);
      expect(settled.billableCostMicroCents).toBe(0);
    });

    it("gives concurrent dispatchers different claims", async () => {
      await Promise.all([createSubmission(), createSubmission()]);
      const [first, second] = await Promise.all([
        claimMailOutbox(database, {
          leaseSeconds: 60,
          limit: 1,
          owner: "first",
        }),
        claimMailOutbox(database, {
          leaseSeconds: 60,
          limit: 1,
          owner: "second",
        }),
      ]);
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0].id).not.toBe(second[0].id);
      await expect(
        claimMailOutbox(database, {
          leaseSeconds: 60,
          limit: 5,
          owner: "third",
        })
      ).resolves.toStrictEqual([]);
    });

    it("fences late completion and failure after another worker reclaims the lease", async () => {
      await createSubmission();
      const [stale] = await claimMailOutbox(database, {
        leaseSeconds: 60,
        limit: 1,
        owner: "first",
      });
      await database
        .update(mailSubmissionOutbox)
        .set({ dueAt: now, leaseUntil: now })
        .where(eq(mailSubmissionOutbox.id, stale.id));
      const [current] = await claimMailOutbox(database, {
        leaseSeconds: 60,
        limit: 1,
        owner: "second",
      });
      expect(current.claimGeneration).toBe(stale.claimGeneration + 1);
      await expect(
        completeMailOutbox(database, stale, "late-receipt")
      ).resolves.toBeFalsy();
      await expect(deferMailOutbox(database, stale, 0)).resolves.toBeFalsy();
      await expect(
        completeMailOutbox(database, current, "current-receipt")
      ).resolves.toBeTruthy();
      await expect(
        completeMailOutbox(database, current, "duplicate-receipt")
      ).resolves.toBeFalsy();
    });

    it("re-publishes lost queued work with the same event identity after queue retention", async () => {
      const submissionId = await createSubmission();
      const [first] = await claimMailOutbox(database, {
        leaseSeconds: 60,
        limit: 1,
        owner: "first",
      });
      await completeMailOutbox(database, first, "queue-accepted");
      await expect(recoverQueuedMailOutbox(database)).resolves.toBe(1);
      const [replay] = await claimMailOutbox(database, {
        leaseSeconds: 60,
        limit: 1,
        owner: "recovery",
      });
      expect(replay.id).toBe(first.id);
      await database
        .update(mailSubmission)
        .set({ nextActionAt: now, status: "pending_confirmation" })
        .where(eq(mailSubmission.id, submissionId));
      await completeMailOutbox(database, replay, "queue-replay");
      await expect(recoverQueuedMailOutbox(database)).resolves.toBe(0);
    });

    it("publishes outside the transaction and retains only sanitized failures", async () => {
      const submissionId = await createSubmission();
      const result = await dispatchMailOutbox(database, {
        limit: 5,
        owner: "publisher",
        async publish(event) {
          await database.transaction(async (transaction) => {
            await transaction.execute(sql`set local lock_timeout = '100ms'`);
            await transaction
              .select()
              .from(mailSubmissionOutbox)
              .where(eq(mailSubmissionOutbox.id, event.id))
              .for("update");
          });
          throw new Error(
            "Provider failure containing private recipient@example.com"
          );
        },
      });
      expect(result).toStrictEqual({ claimed: 1, deferred: 1, published: 0 });
      const [row] = await database
        .select()
        .from(mailSubmissionOutbox)
        .where(eq(mailSubmissionOutbox.submissionId, submissionId));
      expect(row.lastErrorCode).toBe("publication_failed");
      expect(row.publishedAt).toBeNull();
      expect(row.dueAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it("enforces submission ownership and blocks a second unresolved provider call", async () => {
      const submissionId = await createSubmission();
      const attempt = {
        attemptNumber: 1,
        deadline: new Date(now.getTime() + 60_000),
        dispatchGeneration: 1,
        id: randomUUID(),
        intentAt: now,
        organizationId,
        owner: "sender",
        region: "eu-central-1",
        submissionId,
        updatedAt: now,
      };
      await database.insert(mailSendAttempt).values(attempt);
      await expect(
        database
          .insert(mailSendAttempt)
          .values({ ...attempt, attemptNumber: 2, id: randomUUID() })
      ).rejects.toThrow("Failed query");
      await expect(
        database.insert(mailSendAttempt).values({
          ...attempt,
          attemptNumber: 3,
          id: randomUUID(),
          organizationId: randomUUID(),
        })
      ).rejects.toThrow("Failed query");
      await expect(
        database.delete(organization).where(eq(organization.id, organizationId))
      ).rejects.toThrow("Failed query");
    });
  }
);
