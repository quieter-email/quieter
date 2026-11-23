import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  mailDispatchEventSchema,
  mailDispatchPath,
  mailDispatchRequestSchema,
} from "@quieter/mail/dispatch";
import type { MailDispatchEvent } from "@quieter/mail/dispatch";
import { verifyMailPayload } from "@quieter/mail/updates";
import {
  claimMailDispatchEvents,
  completeMailDispatchEvents,
  enrollGmailDispatch,
} from "@quieter/orpc/mail-dispatch";
import { listMailUpdateRecipients } from "@quieter/orpc/mail-updates";

import { readBoundedJson } from "./bounded-json";
import { sendGmailProcessingJob } from "./gmail-processing";
import { broadcastMailUpdate } from "./mail-updates";
import { requestErrorResponse } from "./request-error";
import {
  readLinkedSecret,
  reportWorkerError,
  withSentryReporting,
} from "./worker-runtime";

const dispatchEvent = async (
  env: Env,
  event: MailDispatchEvent,
  eventId: string
) => {
  switch (event.kind) {
    case "gmail": {
      if (env.GmailProcessingWorker === undefined) {
        break;
      }
      const outcome = await sendGmailProcessingJob(env, {
        dueAt: event.dueAt,
        kind: "dispatch-wake",
        mailboxId: event.mailboxId,
        tasks: event.tasks,
      });
      if (outcome.action !== "ack") {
        throw new Error("Mailbox event wake was deferred.");
      }
      break;
    }
    case "gmail-enrollment": {
      if (env.GmailProcessingWorker !== undefined) {
        await enrollGmailDispatch();
      }
      break;
    }
    case "live": {
      const currentRecipients = await listMailUpdateRecipients(
        event.update.mailboxId
      );
      const { recipientUserIds } = event;
      const recipients =
        recipientUserIds === undefined
          ? currentRecipients
          : currentRecipients.filter((recipient) =>
              recipientUserIds.includes(recipient)
            );
      await broadcastMailUpdate(env, event.update, recipients);
      break;
    }
    case "maintenance":
    case "maintenance-enrollment": {
      const response =
        event.kind === "maintenance"
          ? await env.MAIL_MAINTENANCE.fetch(
              "https://maintenance.internal/internal/maintenance/dispatch",
              {
                body: JSON.stringify({
                  dueAt: event.dueAt,
                  scopeKey: event.scopeKey,
                  task: event.task,
                }),
                headers: { "content-type": "application/json" },
                method: "POST",
              }
            )
          : await env.MAIL_MAINTENANCE.fetch(
              "https://maintenance.internal/internal/maintenance/bootstrap",
              { method: "POST" }
            );
      if (
        event.kind === "maintenance" &&
        (response.status === 400 || response.status === 413)
      ) {
        reportWorkerError(new Error("Invalid mail maintenance event."), {
          eventId,
          route: mailDispatchPath,
          status: response.status,
        });
      } else if (!response.ok) {
        throw new Error("Mail maintenance did not accept work.");
      }
      break;
    }
    default: {
      const unsupported: never = event;
      throw new Error(`Unsupported mail dispatch event ${String(unsupported)}`);
    }
  }
};

const drainMailDispatch = async (
  env: Env,
  scope: Parameters<typeof claimMailDispatchEvents>[0]
) => {
  const events = await claimMailDispatchEvents(scope);
  let delivered = 0;
  const concurrency = 8;
  for (let offset = 0; offset < events.length; offset += concurrency) {
    const completed = await Promise.all(
      events
        .slice(offset, offset + concurrency)
        .map(async ({ id, payload }) => {
          try {
            const parsed = mailDispatchEventSchema.safeParse(payload);
            if (parsed.success) {
              await dispatchEvent(env, parsed.data, id);
            } else {
              reportWorkerError(
                new Error("Invalid stored mail dispatch event."),
                {
                  eventId: id,
                  route: mailDispatchPath,
                }
              );
            }
            return [id];
          } catch (error) {
            reportWorkerError(error, { eventId: id, route: mailDispatchPath });
            return [];
          }
        })
    );
    const completedIds = completed.flat();
    // oxlint-disable-next-line no-await-in-loop -- Record successful deliveries before the next wave.
    await completeMailDispatchEvents(completedIds);
    delivered += completedIds.length;
  }
  return { claimed: events.length, delivered };
};

export const repairMailDispatch = async (env: Env) => {
  await withRequestDatabaseClient(async () => {
    for (let page = 0; page < 16; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Enrollment can add work to another shard.
      const results = await Promise.all(
        [0, 1, 2, 3].map(
          async (shard) => await drainMailDispatch(env, { shard })
        )
      );
      if (results.every(({ claimed }) => claimed === 0)) {
        return;
      }
    }
  });
};

export const handleMailDispatch = async (
  request: Request,
  env: Env,
  ctx?: Pick<ExecutionContext, "waitUntil">
) => {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== mailDispatchPath ||
    url.search !== ""
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const body = await readBoundedJson(request, 4096);
    if (
      !(await verifyMailPayload(
        JSON.stringify(body),
        request.headers.get("x-mail-signature") ?? "",
        readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret)
      ))
    ) {
      return new Response(null, { status: 401 });
    }
    const payload = mailDispatchRequestSchema.safeParse(body);
    const now = Date.now();
    if (
      !payload.success ||
      payload.data.expiresAt <= now ||
      payload.data.expiresAt > now + 30_000
    ) {
      return new Response(null, { status: 400 });
    }
    const delivery = withRequestDatabaseClient(
      async () =>
        await drainMailDispatch(env, { eventIds: payload.data.eventIds })
    );
    if (ctx !== undefined) {
      ctx.waitUntil(
        (async () => {
          try {
            await delivery;
          } catch (error) {
            reportWorkerError(error, { route: mailDispatchPath });
          }
        })()
      );
      return new Response(null, { status: 202 });
    }
    const outcome = await delivery;
    return new Response(null, {
      status: outcome.claimed === outcome.delivered ? 204 : 503,
    });
  } catch (error) {
    return requestErrorResponse(error, mailDispatchPath);
  }
};

export default withSentryReporting({
  fetch: handleMailDispatch,
  async scheduled(_event, env) {
    await repairMailDispatch(env);
  },
} satisfies ExportedHandler<Env>);
