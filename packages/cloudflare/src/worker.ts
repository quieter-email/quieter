import {
  handleLiveMailboxRequest,
  handlePubSub,
  requestErrorResponse,
} from "./worker-utils";

export { GmailLiveSyncMailbox } from "./gmail-live-sync-mailbox";
export { signaturesMatch } from "./worker-utils";

export default {
  async fetch(request: Request, env: Env) {
    const route = new URL(request.url).pathname;
    try {
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
} satisfies ExportedHandler<Env>;
