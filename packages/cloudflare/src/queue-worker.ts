import { readLinkedSecret, reportWorkerError } from "./worker-runtime";

type GmailPubSubQueueMessage = {
  emailAddress: string;
  historyId: string;
  pubSubMessageId: string;
  type: "notification";
};

export default {
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
} satisfies ExportedHandler<Env, GmailPubSubQueueMessage>;
