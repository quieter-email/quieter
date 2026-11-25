import {
  GMAIL_MAILBOX_WAKE_PATH,
  gmailMailboxWakeSchema,
  verifyMailPayload,
} from "@quieter/mail/updates";

import { processGmailQueue, sendGmailProcessingJob } from "./gmail-processing";
import { handleMailUpdates } from "./mail-updates";
import { readLinkedSecret, withSentryReporting } from "./worker-runtime";
import {
  handlePubSub,
  readBoundedJson,
  requestErrorResponse,
} from "./worker-utils";

export { GmailLiveSyncMailboxV2 } from "./gmail-live-sync-mailbox";
export { signaturesMatch } from "./worker-utils";

export default withSentryReporting({
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    const route = new URL(request.url).pathname;
    try {
      if (route.startsWith("/mail/")) {
        return await handleMailUpdates(request, env);
      }
      if (route === GMAIL_MAILBOX_WAKE_PATH && request.method === "POST") {
        const body = await readBoundedJson(request, 1024);
        const signature = request.headers.get("x-mail-signature") ?? "";
        const secret = readLinkedSecret(
          env.SST_RESOURCE_GmailLiveSyncTokenSecret
        );
        if (
          !(await verifyMailPayload(JSON.stringify(body), signature, secret))
        ) {
          return new Response(null, { status: 401 });
        }
        const wake = gmailMailboxWakeSchema.safeParse(body);
        const now = Date.now();
        if (
          !wake.success ||
          wake.data.expiresAt <= now ||
          wake.data.expiresAt > now + 30_000
        ) {
          return new Response(null, { status: 400 });
        }
        const { kind, mailboxId } = wake.data;
        const decision = await sendGmailProcessingJob(
          env,
          kind === "sync"
            ? { kind: "maintain", mailboxId }
            : { kind: "automation", mailboxId, tasks: [kind] }
        );
        return new Response(null, {
          status: decision.action === "ack" ? 204 : 503,
        });
      }
      if (route === "/gmail/pubsub" && request.method === "POST") {
        return await handlePubSub(request, env, undefined, ctx);
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return requestErrorResponse(error, route);
    }
  },
  queue: processGmailQueue,
} satisfies ExportedHandler<Env>);

export { MailLiveUser } from "./mail-live-user";
export { MailSnooze } from "./mail-snooze";
export { ReminderMailbox } from "./reminder-mailbox";
export { ScheduledSend } from "./scheduled-send";
