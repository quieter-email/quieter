import { db } from "@quieter/database/client";
import { reportError } from "@quieter/observability";
import {
  maintainMailSynchronization,
  runMailboxSynchronization,
} from "@quieter/orpc/mail-sync";
import { syncBatchSchema, syncIdSchema } from "@quieter/sync";
import {
  verifySyncInternalRequest,
  verifySyncTicket,
} from "@quieter/sync-server/auth";
import { readSyncHealth } from "@quieter/sync-server/health";
import { z } from "zod";

import { maintainSyncBodies } from "./body-maintenance";
import { recordSyncMetric } from "./metrics";
import { withSyncReporting } from "./observability";
import { readSyncRequest, withSyncRuntime } from "./runtime";

export { MailboxSync } from "./mailbox-sync";
export { UserSync } from "./user-sync";

export default withSyncReporting({
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const secret = z
        .object({ value: z.string() })
        .parse(JSON.parse(env.SST_RESOURCE_MailSyncSecret)).value;
      if (url.pathname === "/connect") {
        let userId: string;
        try {
          ({ userId } = verifySyncTicket(
            url.searchParams.get("ticket") ?? "",
            secret
          ));
        } catch {
          return new Response(null, { status: 401 });
        }
        return await env.UserSyncObjects.getByName(userId).fetch(request);
      }
      if (!url.pathname.startsWith("/internal/")) {
        return new Response(null, { status: 404 });
      }
      if (
        !verifySyncInternalRequest(request.headers.get("authorization"), secret)
      ) {
        return new Response(null, { status: 401 });
      }
      if (url.pathname === "/internal/batch" && request.method === "POST") {
        const batch = syncBatchSchema.parse(
          JSON.parse(
            new TextDecoder().decode(
              await readSyncRequest(request, 12 * 1024 * 1024)
            )
          )
        );
        await env.MailboxSyncObjects.getByName(batch.mailboxId).publish(batch);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/internal/health" && request.method === "GET") {
        const health = await withSyncRuntime(
          env,
          async () => await readSyncHealth(db)
        );
        return Response.json(health, {
          headers: { "cache-control": "private, no-store" },
        });
      }
      if (
        url.pathname === "/internal/synchronize" &&
        request.method === "POST"
      ) {
        const { mailboxId } = z
          .object({ mailboxId: syncIdSchema })
          .parse(
            JSON.parse(
              new TextDecoder().decode(await readSyncRequest(request, 4096))
            )
          );
        await env.MailboxSyncObjects.getByName(mailboxId).wake(mailboxId);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/internal/access" && request.method === "POST") {
        const { mailboxId, userIds } = z
          .object({
            mailboxId: syncIdSchema,
            userIds: z.array(syncIdSchema).max(100).default([]),
          })
          .parse(
            JSON.parse(
              new TextDecoder().decode(await readSyncRequest(request, 32_768))
            )
          );
        await env.MailboxSyncObjects.getByName(mailboxId).accessChanged();
        for (const userId of userIds) {
          await env.UserSyncObjects.getByName(userId).accessChanged();
        }
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/internal/revoke" && request.method === "POST") {
        const payload = z
          .object({ mailboxId: syncIdSchema.optional(), userId: syncIdSchema })
          .parse(
            JSON.parse(
              new TextDecoder().decode(await readSyncRequest(request, 4096))
            )
          );
        await env.UserSyncObjects.getByName(payload.userId).revoke(
          payload.mailboxId
        );
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/internal/body") {
        const key = z
          .string()
          .max(1024)
          .regex(/^sync\/bodies\/[^/]+\/[a-f0-9]{64}$/u)
          .parse(url.searchParams.get("key"));
        if (request.method === "PUT") {
          await env.SyncBodies.put(
            key,
            await readSyncRequest(request, 42 * 1024 * 1024)
          );
          return new Response(null, { status: 204 });
        }
        if (request.method === "DELETE") {
          await env.SyncBodies.delete(key);
          return new Response(null, { status: 204 });
        }
        if (request.method === "GET") {
          const body = await env.SyncBodies.get(key);
          return new Response(body?.body ?? null, {
            headers: {
              "cache-control": "private, no-store",
              "content-type": "application/json",
            },
            status: body === null ? 404 : 200,
          });
        }
        if (request.method === "HEAD") {
          return new Response(null, {
            status: (await env.SyncBodies.head(key)) === null ? 404 : 204,
          });
        }
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return new Response(null, { status: 400 });
      }
      reportError(error, { operation: "mail_sync_request" });
      return new Response(null, { status: 503 });
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const started = Date.now();
      try {
        const { mailboxId } = z
          .object({ mailboxId: syncIdSchema })
          .parse(message.body);
        const object = env.MailboxSyncObjects.getByName(mailboxId);
        const generation = await object.beginWork();
        if (generation === null) {
          message.ack();
          continue;
        }
        const result = await withSyncRuntime(
          env,
          async () => await runMailboxSynchronization(mailboxId)
        );
        await object.finishWork(generation, result.hasMore);
        message.ack();
      } catch (error) {
        reportError(error, {
          attempts: message.attempts,
          operation: "mail_sync_queue",
        });
        message.retry({
          delaySeconds: Math.min(300, 2 ** Math.min(message.attempts, 8)),
        });
      } finally {
        recordSyncMetric("queue", {
          ageMs: Math.max(0, started - message.timestamp.getTime()),
          attempts: message.attempts,
          durationMs: Date.now() - started,
        });
      }
    }
  },
  async scheduled(_controller, env) {
    await withSyncRuntime(env, async () => {
      const started = Date.now();
      await maintainMailSynchronization();
      const bodies = await maintainSyncBodies(env.SyncBodies);
      recordSyncMetric("maintenance", {
        ...bodies,
        durationMs: Date.now() - started,
      });
      recordSyncMetric("health", await readSyncHealth(db));
    });
  },
} satisfies ExportedHandler<SyncEnv>);
