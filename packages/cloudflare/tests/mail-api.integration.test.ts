import { createHash } from "node:crypto";

import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  apikey,
  billingSubscription,
  mailDomain,
  mailPayloadUpload,
  mailSubmission,
  mailSubmissionOutbox,
  mailUsageReservation,
  organization,
  user,
} from "@quieter/database/schema";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it, vi } from "vite-plus/test";

import { handleMailApiRequest } from "../src/mail-api-worker.ts";
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
          expect(events).toHaveLength(1);
        });
      } finally {
        await Promise.allSettled(background);
        await withRequestDatabaseClient(async (database) => {
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
