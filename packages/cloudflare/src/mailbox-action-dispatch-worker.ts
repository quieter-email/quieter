import { withRequestDatabaseClient } from "@quieter/database/client";
import { listPendingMailboxActionRunIds } from "@quieter/orpc/mailbox-actions";

import { reportWorkerError } from "./worker-runtime";

const QUEUE_BATCH_SIZE = 100;

export const dispatchPendingMailboxActionRuns = async (
  env: Env,
  listRuns: typeof listPendingMailboxActionRunIds = listPendingMailboxActionRunIds
) => {
  const runs = await listRuns();
  const batches = Array.from(
    { length: Math.ceil(runs.length / QUEUE_BATCH_SIZE) },
    (_, index) =>
      runs.slice(index * QUEUE_BATCH_SIZE, index * QUEUE_BATCH_SIZE + 100)
  );

  await Promise.all(
    batches.map(async (batch) => {
      await env.MailboxActionQueue.sendBatch(
        batch.map(({ runId }) => ({
          body: { runId },
          contentType: "json" as const,
        }))
      );
    })
  );

  return { dispatched: runs.length };
};

export default {
  async scheduled(_event, env, _ctx) {
    try {
      await withRequestDatabaseClient(async () => {
        await dispatchPendingMailboxActionRuns(env);
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "mailbox_action_dispatch_error",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
