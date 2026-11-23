import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  mailDispatchPath,
  mailDispatchRequestSchema,
} from "@quieter/mail/dispatch";
import { verifyMailPayload } from "@quieter/mail/updates";
import {
  completeMailDispatchEvent,
  enrollGmailDispatch,
  getMailDispatchEvent,
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

export const handleMailDispatch = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== mailDispatchPath ||
    url.search !== ""
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const body = await readBoundedJson(request, 1024);
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
    const { eventId } = payload.data;

    await withRequestDatabaseClient(async () => {
      const stored = await getMailDispatchEvent(eventId);
      if (stored === null) {
        return;
      }
      if (!stored.success) {
        reportWorkerError(new Error("Invalid stored mail dispatch event."), {
          eventId,
          route: mailDispatchPath,
        });
        await completeMailDispatchEvent(eventId);
        return;
      }
      const event = stored.data;
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
          throw new Error(
            `Unsupported mail dispatch event ${String(unsupported)}`
          );
        }
      }
      await completeMailDispatchEvent(eventId);
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return requestErrorResponse(error, mailDispatchPath);
  }
};

export default withSentryReporting({
  fetch: handleMailDispatch,
} satisfies ExportedHandler<Env>);
