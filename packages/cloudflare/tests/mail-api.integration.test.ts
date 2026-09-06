import { createHash } from "node:crypto";

import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  apikey,
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
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it, vi } from "vite-plus/test";

import { mailStorageTestLimits } from "../../database/tests/mail-ledger-fixtures.ts";
import { handleMailApiRequest } from "../src/mail-api-worker.ts";
import { handleMailFeedbackRequest } from "../src/mail-feedback-worker.ts";
import { mailSubmissionSenderHandler } from "../src/mail-submission-sender-worker.ts";
import { reportWorkerError } from "../src/worker-runtime.ts";

vi.mock(import("../src/worker-runtime.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  reportWorkerError: vi.fn<typeof reportWorkerError>(),
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  const { env: bindings } = await import("cloudflare:workers");
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      BETTER_AUTH_SECRET: "native-test-only-api-key-secret-at-least-32",
      DATABASE_URL: bindings.AppDatabaseV2.connectionString,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});

const url: unknown = Reflect.get(env, "MIGRATION_TEST_DATABASE_URL");
describe.skipIf(typeof url !== "string" || url === "")(
  "native mail acceptance API",
  () => {
    /* oxlint-disable vitest/max-expects -- One isolated real-database fixture verifies the complete HTTP acceptance and retry lifecycle. */
    it("accepts durably, bounds input, replays at capacity, and keeps status separate", async () => {
      const fixtureConnection = postgres(env.AppDatabaseV2.connectionString, {
        connect_timeout: 5,
        fetch_types: false,
        max: 1,
        prepare: false,
      });
      const fixtureLock = await fixtureConnection.reserve();
      await fixtureLock`select pg_advisory_lock(26920260906)`;
      const organizationId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const id = crypto.randomUUID();
      const key = `quieter_${crypto.randomUUID()}`;
      const now = new Date();
      const background: Promise<unknown>[] = [];
      const context = {
        waitUntil: (promise: Promise<unknown>) => {
          background.push(promise);
        },
      };
      const config = {
        acceptanceEnabled: true,
        limits: {
          global: { maxPending: 100, maxPendingBytes: 100_000_000 },
          maxQueuedAgeSeconds: 3600,
          organization: { maxPending: 1, maxPendingBytes: 100_000_000 },
        },
        organizationIds: [organizationId],
        schemaVersion: 1,
        storageLimits: mailStorageTestLimits,
      };
      const bindings = {
        MailSubmissionPayloads: env.LocalMailStorage,
        MailSubmissionWakeQueue: env.MailSubmissionWakeQueue,
        QUIETER_MAIL_API_CONFIG: JSON.stringify(config),
      };
      const message = {
        attachments: [{ content: "Zml4dHVyZQ==", filename: "fixture.txt" }],
        from: `sender@${organizationId}.example.com`,
        subject: "Native acceptance",
        text: "Fixture",
        to: ["reader@example.com"],
      };
      const idempotencyKey = crypto.randomUUID();
      const request = (body: unknown = message, requestKey = idempotencyKey) =>
        new Request("https://mail.example.test/api/v2/send", {
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            "idempotency-key": requestKey,
          },
          method: "POST",
        });
      try {
        await withRequestDatabaseClient(async (database) => {
          await database.insert(user).values({
            createdAt: now,
            email: `${userId}@example.com`,
            emailVerified: true,
            id: userId,
            name: "Mail API fixture",
            updatedAt: now,
          });
          await database.insert(organization).values({
            billingOwnerUserId: userId,
            createdAt: now,
            id: organizationId,
            name: "Mail API fixture",
            slug: organizationId,
          });
          await database.insert(billingSubscription).values({
            createdAt: now,
            currentPeriodEnd: new Date(now.getTime() + 86_400_000),
            currentPeriodStart: new Date(now.getTime() - 86_400_000),
            id: crypto.randomUUID(),
            metadata: { quieterOrganizationId: organizationId },
            organizationId,
            plan: "managed",
            provider: "polar",
            providerProductId: "fixture",
            providerSubscriptionId: crypto.randomUUID(),
            status: "active",
            updatedAt: now,
            userId,
          });
          await database.insert(mailDomain).values({
            createdAt: now,
            domain: `${organizationId}.example.com`,
            id: crypto.randomUUID(),
            mailFromDomain: `mail.${organizationId}.example.com`,
            organizationId,
            requiredDnsRecords: [],
            status: "verified",
            updatedAt: now,
          });
          await database.insert(apikey).values({
            configId: ORGANIZATION_API_KEY_CONFIG_ID,
            createdAt: now,
            enabled: true,
            expiresAt: new Date(now.getTime() + 600_000),
            id,
            key: createHash("sha256").update(key).digest("base64url"),
            rateLimitEnabled: false,
            referenceId: organizationId,
            updatedAt: now,
          });

          const disabled = await handleMailApiRequest(
            request(),
            { ...bindings, QUIETER_MAIL_API_CONFIG: undefined },
            context
          );
          expect(disabled.status).toBe(503);
          const malformed = await handleMailApiRequest(
            request({ ...message, unsupported: true }),
            bindings,
            context
          );
          expect(malformed.status).toBe(400);
          const oversized = request();
          oversized.headers.set("content-length", String(30 * 1024 * 1024));
          await expect(
            handleMailApiRequest(oversized, bindings, context)
          ).resolves.toMatchObject({ status: 413 });
          await expect(
            handleMailApiRequest(request(message, ""), bindings, context)
          ).resolves.toMatchObject({ status: 400 });
          const wrongMethod = await handleMailApiRequest(
            new Request("https://mail.example.test/api/v2/send"),
            bindings,
            context
          );
          expect({
            allow: wrongMethod.headers.get("allow"),
            status: wrongMethod.status,
          }).toStrictEqual({ allow: "POST", status: 405 });
          const malformedJson = new Request(request(), {
            body: "{private malformed body",
            method: "POST",
          });
          await expect(
            handleMailApiRequest(malformedJson, bindings, context)
          ).resolves.toMatchObject({ status: 400 });
          const stalled = new Request(request(), {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"));
              },
            }),
            method: "POST",
          });
          await expect(
            handleMailApiRequest(stalled, bindings, context)
          ).resolves.toMatchObject({ status: 408 });
          const accepted = await handleMailApiRequest(
            request(),
            {
              ...bindings,
              MailSubmissionWakeQueue: {
                send: vi
                  .fn<typeof env.MailSubmissionWakeQueue.send>()
                  .mockRejectedValue(new Error("private queue fixture")),
              },
            },
            context
          );
          await Promise.all(background);
          expect(reportWorkerError).toHaveBeenCalledWith(
            new Error("Accepted mail requires scheduled outbox recovery."),
            { category: "mail_api_wakeup_failed", route: "send" }
          );
          const result: unknown = await accepted.json();
          expect(accepted.status).toBe(201);
          expect(result).toStrictEqual({
            messageId: accepted.headers.get("location")?.split("/").at(-1),
            status: "queued",
          });
          const replay = await handleMailApiRequest(
            request(),
            bindings,
            context
          );
          expect({
            body: await replay.json(),
            status: replay.status,
          }).toStrictEqual({ body: result, status: 200 });
          await expect(
            handleMailApiRequest(
              request({ ...message, subject: "different" }),
              bindings,
              context
            )
          ).resolves.toMatchObject({ status: 409 });
          const overload = await handleMailApiRequest(
            request(message, crypto.randomUUID()),
            bindings,
            context
          );
          expect({
            retry: overload.headers.get("retry-after"),
            status: overload.status,
          }).toStrictEqual({ retry: "30", status: 503 });
          const location = accepted.headers.get("location");
          if (location === null) {
            throw new Error("Missing status location.");
          }
          const statusRequest = () =>
            new Request(new URL(location, "https://mail.example.test"), {
              headers: { authorization: `Bearer ${key}` },
            });
          const status = await handleMailApiRequest(
            statusRequest(),
            {
              ...bindings,
              QUIETER_MAIL_API_CONFIG: JSON.stringify({
                ...config,
                acceptanceEnabled: false,
              }),
            },
            context
          );
          await expect(status.json()).resolves.toMatchObject({
            status: "queued",
          });
          expect(status.headers.get("cache-control")).toBe("no-store");
          const submissionId = location.split("/").at(-1);
          if (submissionId === undefined) {
            throw new Error("Missing submission identifier.");
          }
          const senderConfig = {
            accountId: "000000000269",
            configurationSetName: "native-fixture",
            enabled: true,
            organizationIds: [organizationId],
            region: "eu-central-1",
            schemaVersion: 1,
            stage: "native-fixture",
          };
          const senderBindings = {
            ...bindings,
            QUIETER_MAIL_SENDER_CONFIG: JSON.stringify(senderConfig),
            SST_RESOURCE_App: JSON.stringify({ stage: "native-fixture" }),
            SST_RESOURCE_MailSenderCredentials: JSON.stringify({
              value: JSON.stringify({
                accessKeyId: "fixture",
                secretAccessKey: "fixture",
                stage: "native-fixture",
              }),
            }),
          };
          const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
            Response.json({
              SendQuota: {
                Max24HourSend: 100,
                MaxSendRate: 10,
                SentLast24Hours: 0,
              },
              SendingEnabled: true,
            })
          );
          vi.stubGlobal("fetch", fetch);
          const dispatch = {
            ack: vi.fn<() => void>(),
            attempts: 1,
            body: {
              eventType: "submission.dispatch",
              id: crypto.randomUUID(),
              organizationId,
              schemaVersion: 1,
              submissionId,
            },
            id: crypto.randomUUID(),
            retry: vi.fn<(options?: QueueRetryOptions) => void>(),
            timestamp: now,
          };
          const batch = {
            ackAll: vi.fn<() => void>(),
            messages: [dispatch],
            metadata: { metrics: { backlogBytes: 0, backlogCount: 1 } },
            queue: "native-fixture",
            retryAll: vi.fn<() => void>(),
          };
          await mailSubmissionSenderHandler.queue(batch, {
            ...senderBindings,
            QUIETER_MAIL_SENDER_CONFIG: undefined,
          });
          expect(dispatch.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
          expect(fetch).not.toHaveBeenCalled();
          await mailSubmissionSenderHandler.scheduled(
            {
              cron: "* * * * *",
              noRetry: vi.fn<() => void>(),
              scheduledTime: Date.now(),
            },
            senderBindings
          );
          fetch.mockResolvedValue(
            Response.json({ MessageId: "native-accepted" })
          );
          await mailSubmissionSenderHandler.queue(batch, senderBindings);
          expect(dispatch.ack).toHaveBeenCalledOnce();
          const sent = await handleMailApiRequest(
            statusRequest(),
            bindings,
            context
          );
          await expect(sent.json()).resolves.toMatchObject({
            status: "accepted",
          });
          await mailSubmissionSenderHandler.queue(batch, senderBindings);
          expect(fetch).toHaveBeenCalledTimes(2);
          const unknown = await handleMailApiRequest(
            request(message, crypto.randomUUID()),
            bindings,
            context
          );
          const unknownId = unknown.headers.get("location")?.split("/").at(-1);
          expect(unknown.status).toBe(201);
          if (unknownId === undefined) {
            throw new Error("Missing unknown-outcome fixture.");
          }
          const uncertainDispatch = {
            ...dispatch,
            ack: vi.fn<() => void>(),
            body: { ...dispatch.body, submissionId: unknownId },
          };
          await database
            .update(mailSendCapacity)
            .set({ nextSendAt: new Date(0) })
            .where(eq(mailSendCapacity.key, "000000000269:eu-central-1"));
          fetch.mockRejectedValue(new Error("private lost response"));
          await mailSubmissionSenderHandler.queue(
            { ...batch, messages: [uncertainDispatch] },
            senderBindings
          );
          await mailSubmissionSenderHandler.queue(
            { ...batch, messages: [uncertainDispatch] },
            senderBindings
          );
          expect(fetch).toHaveBeenCalledTimes(3);
          expect(uncertainDispatch.ack).toHaveBeenCalledTimes(2);
          const [unconfirmed] = await database
            .select({ status: mailSubmission.status })
            .from(mailSubmission)
            .where(eq(mailSubmission.id, unknownId));
          expect(unconfirmed.status).toBe("pending_confirmation");
          vi.unstubAllGlobals();
          const [attempt] = await database
            .select()
            .from(mailSendAttempt)
            .where(eq(mailSendAttempt.submissionId, unknownId));
          const feedbackConfig = {
            enabled: true,
            endpoint: "https://feedback.example.test/internal/mail/feedback",
            queueArn: "arn:aws:sqs:eu-central-1:000000000269:fixture",
            schemaVersion: 1,
            stage: "native-fixture",
            topicArn: `arn:aws:sns:eu-central-1:000000000269:${organizationId}`,
          };
          const feedbackBindings = {
            QUIETER_MAIL_FEEDBACK_CONFIG: JSON.stringify(feedbackConfig),
            SST_RESOURCE_App: JSON.stringify({ stage: "native-fixture" }),
            SST_RESOURCE_MailFeedbackBridgeToken: JSON.stringify({
              value: JSON.stringify({
                stage: "native-fixture",
                token: "a".repeat(64),
              }),
            }),
          };
          const feedback = {
            Message: JSON.stringify({
              delivery: {
                recipients: message.to,
                timestamp: new Date().toISOString(),
              },
              eventType: "Delivery",
              mail: {
                destination: message.to,
                messageId: "native-late-confirmation",
                source: message.from,
                tags: {
                  quieter_attempt: [attempt.id],
                  quieter_submission: [unknownId],
                },
                timestamp: attempt.intentAt.toISOString(),
              },
            }),
            MessageId: crypto.randomUUID(),
            TopicArn: feedbackConfig.topicArn,
            Type: "Notification",
          };
          const feedbackRequest = (body = feedback, token = "a".repeat(64)) =>
            new Request(feedbackConfig.endpoint, {
              body: JSON.stringify(body),
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "x-quieter-feedback-version": "1",
              },
              method: "POST",
            });
          await expect(
            handleMailFeedbackRequest(
              feedbackRequest(feedback, "wrong"),
              feedbackBindings,
              context
            )
          ).resolves.toMatchObject({ status: 401 });
          await expect(
            handleMailFeedbackRequest(
              feedbackRequest({
                ...feedback,
                TopicArn: `${feedback.TopicArn}-other`,
              }),
              feedbackBindings,
              context
            )
          ).resolves.toMatchObject({ status: 403 });
          const retained = await handleMailFeedbackRequest(
            feedbackRequest(),
            feedbackBindings,
            context
          );
          expect(retained.status).toBe(201);
          await expect(retained.json()).resolves.toStrictEqual({
            eventId: feedback.MessageId,
            schemaVersion: 1,
            status: "retained",
          });
          await Promise.all(background);
          await expect(
            handleMailFeedbackRequest(
              feedbackRequest(),
              feedbackBindings,
              context
            )
          ).resolves.toMatchObject({ status: 200 });
          await Promise.all(background);
          const [confirmed] = await database
            .select({ status: mailSubmission.status })
            .from(mailSubmission)
            .where(eq(mailSubmission.id, unknownId));
          expect(confirmed.status).toBe("accepted");
          expect(fetch).toHaveBeenCalledTimes(3);
          const [inbox] = await database
            .select({ status: mailFeedbackInbox.status })
            .from(mailFeedbackInbox)
            .where(eq(mailFeedbackInbox.providerEventId, feedback.MessageId));
          expect(inbox.status).toBe("applied");
          await database
            .update(apikey)
            .set({
              lastRequest: new Date(),
              rateLimitEnabled: true,
              rateLimitMax: 1,
              rateLimitTimeWindow: 60_000,
              requestCount: 1,
            })
            .where(eq(apikey.id, id));
          await expect(
            handleMailApiRequest(statusRequest(), bindings, context)
          ).resolves.toMatchObject({ status: 429 });
          await database
            .update(apikey)
            .set({ enabled: false })
            .where(eq(apikey.id, id));
          await expect(
            handleMailApiRequest(statusRequest(), bindings, context)
          ).resolves.toMatchObject({ status: 401 });
          await Promise.all(background);
          const events = await database
            .select()
            .from(mailSubmissionOutbox)
            .where(eq(mailSubmissionOutbox.organizationId, organizationId));
          expect(
            events.map((event) => event.eventType).toSorted()
          ).toStrictEqual([
            "submission.accepted",
            "submission.accepted",
            "submission.dispatch",
            "submission.dispatch",
          ]);
        });
      } finally {
        vi.unstubAllGlobals();
        await Promise.allSettled(background);
        await withRequestDatabaseClient(async (database) => {
          await database
            .delete(mailFeedbackInbox)
            .where(
              eq(
                mailFeedbackInbox.source,
                `arn:aws:sns:eu-central-1:000000000269:${organizationId}`
              )
            );
          await database
            .delete(organizationMailDeliveryEvent)
            .where(
              eq(organizationMailDeliveryEvent.organizationId, organizationId)
            );
          await database
            .delete(organizationMailDeliveryRecipient)
            .where(
              eq(
                organizationMailDeliveryRecipient.organizationId,
                organizationId
              )
            );
          const uploads = await database
            .select()
            .from(mailPayloadUpload)
            .where(eq(mailPayloadUpload.organizationId, organizationId));
          await Promise.all(
            uploads.flatMap((upload) =>
              upload.objects.map(async (object) => {
                await env.LocalMailStorage.delete(object.key);
              })
            )
          );
          await database
            .delete(mailUsageReservation)
            .where(eq(mailUsageReservation.organizationId, organizationId));
          await database
            .delete(mailSendAttempt)
            .where(eq(mailSendAttempt.organizationId, organizationId));
          await database
            .delete(mailSendCapacity)
            .where(eq(mailSendCapacity.key, "000000000269:eu-central-1"));
          await database
            .delete(mailSubmissionOutbox)
            .where(eq(mailSubmissionOutbox.organizationId, organizationId));
          await database
            .delete(mailSubmission)
            .where(eq(mailSubmission.organizationId, organizationId));
          await database
            .delete(mailPayloadUpload)
            .where(eq(mailPayloadUpload.organizationId, organizationId));
          await database.delete(apikey).where(eq(apikey.id, id));
          await database
            .delete(organization)
            .where(eq(organization.id, organizationId));
          await database.delete(user).where(eq(user.id, userId));
        });
        await fixtureLock`select pg_advisory_unlock(26920260906)`;
        fixtureLock.release();
        await fixtureConnection.end({ timeout: 1 });
      }
    }, 30_000);
  }
);
