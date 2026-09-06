import { acceptMailSubmission } from "@quieter/database/mail-acceptance";
import { beginMailSendAttempt } from "@quieter/database/mail-attempts";
import {
  mailSendAttempt,
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
  organization,
} from "@quieter/database/schema";
import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vite-plus/test";

import { publishPendingMailSubmissions } from "../src/mail-submission-publisher-worker.ts";

const url: unknown = Reflect.get(env, "MIGRATION_TEST_DATABASE_URL");

describe.skipIf(typeof url !== "string" || url === "")(
  "mail ledger through native queue publication",
  () => {
    it("reserves a cold connection, reports SQL errors, and closes without an unhandled rejection", async () => {
      const connection = postgres(env.AppDatabaseV2.connectionString, {
        connect_timeout: 5,
        fetch_types: false,
        max: 1,
        prepare: false,
      });
      try {
        const reserved = await connection.reserve();
        try {
          await expect(reserved`select 42 as value`).resolves.toMatchObject([
            { value: 42 },
          ]);
          await expect(reserved`select 1 / 0`).rejects.toMatchObject({
            code: "22012",
          });
        } finally {
          reserved.release();
        }
        await expect(connection`select 43 as value`).resolves.toMatchObject([
          { value: 43 },
        ]);
      } finally {
        await connection.end({ timeout: 1 });
      }
    }, 10_000);

    /* oxlint-disable vitest/max-expects -- Exercise the real transaction, native queue, and ambiguous-attempt recovery as one isolated fixture. */
    it("republishes durable work after a lost wakeup and never resends an abandoned attempt", async () => {
      if (typeof url !== "string" || url === "") {
        throw new Error("Missing disposable database fixture.");
      }
      const connection = postgres(env.AppDatabaseV2.connectionString, {
        connect_timeout: 5,
        fetch_types: false,
        max: 3,
        prepare: false,
      });
      const database = drizzle({ client: connection });
      const fixtureConnection = postgres(env.AppDatabaseV2.connectionString, {
        connect_timeout: 5,
        fetch_types: false,
        max: 1,
        prepare: false,
      });
      const fixtureLock = await fixtureConnection.reserve();
      await fixtureLock`select pg_advisory_lock(26920260906)`;
      const organizationId = crypto.randomUUID();
      const now = new Date();
      const send = vi.spyOn(env.MailSubmissionDispatchQueue, "send");
      try {
        await database.insert(organization).values({
          createdAt: now,
          id: organizationId,
          name: "Native mail fixture",
          slug: organizationId,
        });
        const accepted = await acceptMailSubmission(database, {
          async assertAuthorization(transaction) {
            await transaction.execute(sql`select 1`);
          },
          attachmentBytes: 0,
          idempotencyKey: crypto.randomUUID(),
          limits: {
            global: { maxPending: 100, maxPendingBytes: 100_000_000 },
            maxQueuedAgeSeconds: 3600,
            organization: { maxPending: 100, maxPendingBytes: 100_000_000 },
          },
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
            messageHeaderId: "<native-fixture@example.com>",
            metadata: {},
            openTracking: false,
            preparedAt: now.toISOString(),
            replyTo: [],
            subject: "Native fixture",
            tags: [],
            text: "Fixture",
            to: ["reader@example.com"],
            transportHtml: null,
          },
          recipientCount: 1,
          requestHash: "b".repeat(64),
          async reserveBudget(transaction) {
            await transaction.execute(sql`select 1`);
            return {
              billableCostMicroCents: 0,
              includedCostMicroCents: 1,
              periodEnd: new Date(now.getTime() + 86_400_000),
              periodStart: new Date(now.getTime() - 86_400_000),
              sesCostMicroCents: 1,
            };
          },
        });
        const id = accepted.result.messageId;
        await expect(
          publishPendingMailSubmissions(database, env, true)
        ).resolves.toMatchObject({ deferred: 0, published: 1 });
        await database
          .update(mailSubmission)
          .set({ nextActionAt: sql`now() - interval '1 minute'` })
          .where(eq(mailSubmission.id, id));
        await expect(
          publishPendingMailSubmissions(database, env, true)
        ).resolves.toMatchObject({ deferred: 0, published: 1 });
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][0]).toStrictEqual(send.mock.calls[1][0]);
        const attempt = await beginMailSendAttempt(database, {
          async assertPolicy(transaction) {
            await transaction.execute(sql`select 1`);
          },
          organizationId,
          owner: "native-fixture",
          region: "eu-central-1",
          submissionId: id,
        });
        if (attempt === null) {
          throw new Error("Missing fixture attempt.");
        }
        await database
          .update(mailSendAttempt)
          .set({
            deadline: sql`now() - interval '1 minute'`,
            intentAt: sql`now() - interval '2 minutes'`,
          })
          .where(eq(mailSendAttempt.id, attempt.id));
        await database
          .update(mailSubmission)
          .set({ nextActionAt: sql`now() - interval '1 minute'` })
          .where(eq(mailSubmission.id, id));
        await expect(
          publishPendingMailSubmissions(database, env, true)
        ).resolves.toMatchObject({ published: 0 });
        const [submission] = await database
          .select({ status: mailSubmission.status })
          .from(mailSubmission)
          .where(eq(mailSubmission.id, id));
        expect(submission.status).toBe("pending_confirmation");
        expect(send).toHaveBeenCalledTimes(2);
      } finally {
        send.mockRestore();
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
        await fixtureLock`select pg_advisory_unlock(26920260906)`;
        fixtureLock.release();
        await fixtureConnection.end({ timeout: 1 });
        await connection.end({ timeout: 1 });
      }
    }, 30_000);
    /* oxlint-enable vitest/max-expects */
  }
);
