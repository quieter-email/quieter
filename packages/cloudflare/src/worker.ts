import {
  handleLiveMailboxRequest,
  handlePubSub,
  readLinkedSecret,
  reportWorkerError,
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

  async queue(batch, env, _ctx) {
    await Promise.all(
      batch.messages.map(async (message) => {
        const response = await fetch(env.GMAIL_PUBSUB_PROCESS_URL, {
          body: JSON.stringify(message.body),
          headers: {
            authorization: `Bearer ${readLinkedSecret(env.SST_RESOURCE_GmailPubSubProcessToken)}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        if (!response.ok) {
          const error = new Error(
            `Gmail Pub/Sub processor returned ${response.status}.`
          );
          reportWorkerError(error, {
            category: "processor_response_error",
            route: "queue",
            status: response.status,
          });
          throw error;
        }
        message.ack();
      })
    );
  },
} satisfies ExportedHandler<
  Env,
  {
    emailAddress: string;
    historyId: string;
    pubSubMessageId: string;
    type: "notification";
  }
>;
