import { withRequestDatabaseClient } from "@quieter/database/client";
import { listGmailPubSubMaintenanceJobs } from "@quieter/orpc/gmail-pubsub";

import type { GmailPubSubQueueMessage } from "./queue-worker";
import { reportWorkerError } from "./worker-runtime";

const QUEUE_BATCH_SIZE = 100;

export const enqueueGmailMaintenanceJobs = async (
  env: Env,
  listJobs: typeof listGmailPubSubMaintenanceJobs = listGmailPubSubMaintenanceJobs
) => {
  const jobs = await listJobs();
  const batches = Array.from(
    { length: Math.ceil(jobs.length / QUEUE_BATCH_SIZE) },
    (_, index) =>
      jobs.slice(index * QUEUE_BATCH_SIZE, index * QUEUE_BATCH_SIZE + 100)
  );

  await Promise.all(
    batches.map(async (batch) => {
      await env.GmailPsQueue.sendBatch(
        batch.map(({ emailAddress, mailboxId }) => ({
          body: {
            emailAddress,
            mailboxId,
            type: "maintenance",
          } satisfies GmailPubSubQueueMessage,
          contentType: "json" as const,
        }))
      );
    })
  );

  return { enqueued: jobs.length };
};

export default {
  async scheduled(_event, env, _ctx) {
    try {
      await withRequestDatabaseClient(async () => {
        await enqueueGmailMaintenanceJobs(env);
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "gmail_maintenance_error",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
