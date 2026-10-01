import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

import { runGmailMaintenance } from "./gmail-maintenance-worker";
import { broadcastGmailUpdate } from "./mail-updates";
import realtimeWorker from "./worker";
import {
  parseGmailNotification,
  broadcastMailboxEvent,
  readBoundedJson,
  requestErrorResponse,
  signaturesMatch,
} from "./worker-utils";

export { MailLiveUser } from "./mail-live-user";
export { GmailLiveSyncMailboxV2 } from "./gmail-live-sync-mailbox";

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
    if (url.pathname === "/gmail/live" || url.pathname.startsWith("/mail/")) {
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
    if (url.pathname === "/__dev/mail/seed") {
      try {
        const input = z
          .object({ fresh: z.boolean().optional(), ownerEmail: z.email() })
          .safeParse(await readBoundedJson(request, 4096));
        if (!input.success) {
          return new Response(null, { status: 400 });
        }
        const { seedLocalManagedMail } =
          await import("@quieter/orpc/managed-mail/local-fixtures");
        return Response.json(
          await withRequestDatabaseClient(
            async () =>
              await seedLocalManagedMail(input.data.ownerEmail, {
                fresh: input.data.fresh,
              })
          )
        );
      } catch (error) {
        return requestErrorResponse(error, "local-mail-fixtures");
      }
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
        const { processGmailPubSubNotification } =
          await import("@quieter/orpc/gmail-pubsub");
        const result = await withRequestDatabaseClient(
          async () =>
            await processGmailPubSubNotification({
              ...notification,
              pubSubMessageId: delivery.data.message.messageId,
            })
        );
        if (!result.ignored && result.busy === true) {
          return new Response(null, { status: 503 });
        }
        if (!result.ignored) {
          await Promise.allSettled([
            broadcastMailboxEvent(
              env,
              notification.emailAddress,
              "mailbox-dirty"
            ),
            broadcastGmailUpdate(
              env,
              notification.emailAddress,
              "mailbox.changed"
            ),
          ]);
        }
        return new Response(null, { status: 204 });
      } catch (error) {
        return requestErrorResponse(error, "local-pubsub");
      }
    }
    if (url.pathname === "/__dev/maintenance") {
      try {
        return Response.json(await runGmailMaintenance(env));
      } catch (error) {
        return requestErrorResponse(error, "local-maintenance");
      }
    }
    if (url.pathname === "/__dev/mail-recovery") {
      const { cleanupRateLimitBuckets } =
        await import("@quieter/orpc/abuse-protection");
      const { recoverMailSends } = await import("@quieter/orpc/mail-send");
      const { cleanupMailObjects } =
        await import("@quieter/orpc/managed-mail/storage");
      const { processManagedRuleBackfills } =
        await import("@quieter/orpc/managed-mail/rule-backfills");
      await withRequestDatabaseClient(async () => {
        await recoverMailSends();
        await cleanupMailObjects();
        await cleanupRateLimitBuckets();
        await processManagedRuleBackfills();
      });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
