import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

import { runGmailMaintenance } from "./gmail-maintenance-worker";
import {
  enqueueGmailNotification,
  processGmailQueue,
} from "./gmail-processing";
import realtimeWorker from "./worker";
import {
  parseGmailNotification,
  readBoundedJson,
  requestErrorResponse,
  signaturesMatch,
} from "./worker-utils";

export { MailLiveUser } from "./mail-live-user";
export { ReminderMailbox } from "./reminder-mailbox";
export { ScheduledSend } from "./scheduled-send";
export { GmailLiveSyncMailboxV2 } from "./gmail-live-sync-mailbox";

const deliverySchema = z.object({
  message: z.object({ data: z.string().min(1), messageId: z.string().min(1) }),
  subscription: z.string().min(1),
});

export default {
  async fetch(request, env, ctx?: ExecutionContext) {
    if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
      return new Response(null, { status: 404 });
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/mail/")) {
      return await realtimeWorker.fetch(request, env, ctx);
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
          .object({
            fresh: z.boolean().optional(),
            ownerEmail: z.email(),
            reminderReply: z.enum(["acknowledgement", "fulfilled"]).optional(),
            reminders: z.boolean().optional(),
            rendering: z.boolean().optional(),
          })
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
                reminderReply: input.data.reminderReply,
                reminders: input.data.reminders,
                rendering: input.data.rendering,
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
        await enqueueGmailNotification(
          {
            emailAddress: notification.emailAddress.trim().toLowerCase(),
            historyId: notification.historyId,
            pubSubMessageId: delivery.data.message.messageId,
          },
          env,
          ctx
        );
        return new Response(null, { status: 204 });
      } catch (error) {
        return requestErrorResponse(error, "local-pubsub");
      }
    }
    if (url.pathname === "/__dev/scheduled-send") {
      try {
        const { reconcileScheduledSends } =
          await import("@quieter/orpc/scheduled-send/repair");
        return Response.json(
          await withRequestDatabaseClient(
            async () => await reconcileScheduledSends({ limit: 4 })
          )
        );
      } catch (error) {
        return requestErrorResponse(error, "local-scheduled-send");
      }
    }
    if (url.pathname === "/__dev/maintenance") {
      try {
        return Response.json(await runGmailMaintenance(env));
      } catch (error) {
        return requestErrorResponse(error, "local-maintenance");
      }
    }
    if (url.pathname === "/__dev/importance") {
      try {
        const { processPendingMailImportance } =
          await import("@quieter/orpc/mail-importance");
        await withRequestDatabaseClient(async () => {
          await processPendingMailImportance({ limit: 1 });
        });
        return Response.json({ processed: true });
      } catch (error) {
        return requestErrorResponse(error, "local-mail-importance");
      }
    }
    if (url.pathname === "/__dev/actions") {
      try {
        const { drainMailAgentRuns } = await import("@quieter/orpc/mail-agent");
        return Response.json(
          await withRequestDatabaseClient(
            async () => await drainMailAgentRuns({ limit: 1 })
          )
        );
      } catch (error) {
        return requestErrorResponse(error, "local-mail-agent");
      }
    }
    if (url.pathname === "/__dev/reminders") {
      try {
        const { reconcileReminderSchedules } =
          await import("@quieter/orpc/reminders/clock");
        const { processReminderJobs } =
          await import("@quieter/orpc/reminders/runtime");
        return Response.json(
          await withRequestDatabaseClient(async () => {
            const schedules = await reconcileReminderSchedules({ limit: 20 });
            const jobs = await processReminderJobs({
              allowLocal: true,
              limit: 4,
            });
            return { jobs, schedules };
          })
        );
      } catch (error) {
        return requestErrorResponse(error, "local-reminders");
      }
    }
    if (url.pathname === "/__dev/semantic-index") {
      try {
        const input = z
          .object({
            kind: z.enum(["memory", "chat", "mail"]),
            mailboxId: z.string().min(1).max(500),
            userId: z.string().min(1).max(500),
          })
          .safeParse(await readBoundedJson(request, 4096));
        if (!input.success) {
          return Response.json(
            { error: "Choose a local user, mailbox and search type." },
            { status: 400 }
          );
        }
        const { requestSemanticIndex, processPendingSemanticIndexes } =
          await import("@quieter/orpc/semantic-index");
        return Response.json(
          await withRequestDatabaseClient(async () => {
            await requestSemanticIndex(input.data);
            return await processPendingSemanticIndexes({
              allowLocal: true,
              limit: 3,
              mailboxId: input.data.mailboxId,
              userId: input.data.userId,
            });
          })
        );
      } catch (error) {
        return requestErrorResponse(error, "local-semantic-index");
      }
    }
    if (url.pathname === "/__dev/memory") {
      try {
        const input = z
          .object({ userId: z.string().min(1).max(500) })
          .safeParse(await readBoundedJson(request, 4096));
        if (!input.success) {
          return Response.json(
            { error: "Choose a local user to process memory for." },
            { status: 400 }
          );
        }
        const { processPendingAiMemoryEvents } =
          await import("@quieter/orpc/ai-memory");
        const { processPendingMailMemoryBootstrap } =
          await import("@quieter/orpc/ai-memory-capture");
        return Response.json(
          await withRequestDatabaseClient(async () => {
            const bootstrap = await processPendingMailMemoryBootstrap({
              allowLocal: true,
              userId: input.data.userId,
            });
            const memory = await processPendingAiMemoryEvents({
              allowLocal: true,
              userId: input.data.userId,
            });
            return { bootstrap, ...memory };
          })
        );
      } catch (error) {
        return requestErrorResponse(error, "local-memory");
      }
    }
    if (url.pathname === "/__dev/mail-recovery") {
      const { cleanupRateLimitBuckets } =
        await import("@quieter/orpc/abuse-protection");
      const { recoverMailSends } = await import("@quieter/orpc/mail-send");
      const { processPendingAiMemoryEvents } =
        await import("@quieter/orpc/ai-memory");
      const { cleanupGmailComposeOperations } =
        await import("@quieter/orpc/gmail-compose-retention");
      const { cleanupMailObjects } =
        await import("@quieter/orpc/managed-mail/storage");
      const { processManagedRuleBackfills } =
        await import("@quieter/orpc/managed-mail/rule-backfills");
      const { retryPendingManagedVerificationCodes } =
        await import("@quieter/orpc/managed-mail/ingestion");
      const { cleanupMailboxVerificationCodes } =
        await import("@quieter/orpc/verification-codes");
      const { drainMailAgentRuns } = await import("@quieter/orpc/mail-agent");
      await withRequestDatabaseClient(async () => {
        const results = await Promise.allSettled([
          recoverMailSends(),
          processPendingAiMemoryEvents(),
          cleanupGmailComposeOperations(),
          cleanupMailObjects(),
          cleanupRateLimitBuckets(),
          processManagedRuleBackfills(),
          retryPendingManagedVerificationCodes(),
          cleanupMailboxVerificationCodes(),
          drainMailAgentRuns({ limit: 1 }),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed !== undefined) {
          throw failed.reason;
        }
      });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  },
  queue: processGmailQueue,
} satisfies ExportedHandler<Env>;
