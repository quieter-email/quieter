import { handleMailUpdates } from "./mail-updates";
import { withSentryReporting } from "./worker-runtime";
import {
  handleLiveMailboxRequest,
  handlePubSub,
  requestErrorResponse,
} from "./worker-utils";

export { GmailLiveSyncMailboxV2 } from "./gmail-live-sync-mailbox";
export { signaturesMatch } from "./worker-utils";

export default withSentryReporting({
  async fetch(request: Request, env: Env) {
    const route = new URL(request.url).pathname;
    try {
      if (route.startsWith("/mail/")) {
        return await handleMailUpdates(request, env);
      }
      if (route === "/gmail/live") {
        return await handleLiveMailboxRequest(request, env);
      }
      if (route === "/gmail/pubsub" && request.method === "POST") {
        return await handlePubSub(request, env);
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return requestErrorResponse(error, route);
    }
  },
} satisfies ExportedHandler<Env>);

export { MailLiveUser } from "./mail-live-user";
