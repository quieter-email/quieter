import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

import { enqueueGmailMaintenanceJobs } from "./gmail-maintenance-worker";
import { dispatchPendingMailboxActionRuns } from "./mailbox-action-dispatch-worker";
import actionWorker from "./mailbox-action-worker";
import gmailWorker from "./queue-worker";
import realtimeWorker from "./worker";
import {
  parseGmailNotification,
  readBoundedJson,
  requestErrorResponse,
  signaturesMatch,
} from "./worker-utils";

export { GmailLiveSyncMailbox } from "./gmail-live-sync-mailbox";

const deliverySchema = z.object({
  message: z.object({ data: z.string().min(1), messageId: z.string().min(1) }),
  subscription: z.string().min(1),
});

export default {
  async fetch(request, env) {
    if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
      return new Response(null, { status: 404 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/gmail/live") {
      return await realtimeWorker.fetch(request, env);
    }
    const token = serverEnv.QUIETER_LOCAL_WORKER_TOKEN;
    if (
      token === undefined ||
      request.headers.has("origin") ||
      !(await signaturesMatch(
        request.headers.get("authorization") ?? "",
        `Bearer ${token}`
      ))
    ) {
      return new Response(null, { status: 403 });
    }
    if (url.pathname === "/__dev/health" && request.method === "GET") {
      return Response.json({
        mode: serverEnv.QUIETER_LOCAL_PROVIDER_MODE,
        watchOwner: serverEnv.QUIETER_LOCAL_GMAIL_WATCH_OWNER,
      });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    if (url.pathname === "/__dev/pubsub") {
      try {
        const delivery = deliverySchema.safeParse(
          await readBoundedJson(request, 65_536)
        );
        if (!delivery.success) {
          return new Response(null, { status: 400 });
        }
        if (delivery.data.subscription !== env.GMAIL_PUBSUB_SUBSCRIPTION) {
          return new Response(null, { status: 403 });
        }
        const notification = parseGmailNotification(delivery.data.message.data);
        await env.GmailPsQueue.send({
          ...notification,
          pubSubMessageId: delivery.data.message.messageId,
          type: "notification",
        });
        return new Response(null, { status: 204 });
      } catch (error) {
        return requestErrorResponse(error, "local-pubsub");
      }
    }
    if (url.pathname === "/__dev/maintenance") {
      return Response.json(
        await withRequestDatabaseClient(
          async () => await enqueueGmailMaintenanceJobs(env)
        )
      );
    }
    if (url.pathname === "/__dev/actions") {
      return Response.json(
        await withRequestDatabaseClient(
          async () => await dispatchPendingMailboxActionRuns(env)
        )
      );
    }
    return new Response(null, { status: 404 });
  },
  async queue(batch, env, ctx) {
    if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
      throw new Error("Local Worker cannot run outside development.");
    }
    if (batch.queue === "quieter-local-gmail") {
      await gmailWorker.queue(batch, env, ctx);
    } else if (batch.queue === "quieter-local-actions") {
      await actionWorker.queue(batch, env, ctx);
    } else {
      throw new Error("Unexpected local queue.");
    }
  },
} satisfies ExportedHandler<Env>;
