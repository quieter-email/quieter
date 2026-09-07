import { withRequestDatabaseClient } from "@quieter/database/client";
import { cleanupRateLimitBuckets } from "@quieter/orpc/abuse-protection";
import { recoverMailSends } from "@quieter/orpc/mail-send";
import {
  claimPendingMailboxActionRuns,
  releaseMailboxActionRunDispatchClaims,
} from "@quieter/orpc/mailbox-actions";
import { cleanupMailObjects } from "@quieter/orpc/managed-mail/storage";

import { reportWorkerError, withSentryReporting } from "./worker-runtime";

const QUEUE_BATCH_SIZE = 100;

type DispatchDependencies = {
  claimRuns?: typeof claimPendingMailboxActionRuns;
  releaseClaims?: typeof releaseMailboxActionRunDispatchClaims;
};

export const dispatchPendingMailboxActionRuns = async (
  env: Env,
  dependencies: DispatchDependencies = {}
) => {
  const claimRuns = dependencies.claimRuns ?? claimPendingMailboxActionRuns;
  const releaseClaims =
    dependencies.releaseClaims ?? releaseMailboxActionRunDispatchClaims;
  const runs = await claimRuns();
  const batches = Array.from(
    { length: Math.ceil(runs.length / QUEUE_BATCH_SIZE) },
    (_, index) =>
      runs.slice(index * QUEUE_BATCH_SIZE, (index + 1) * QUEUE_BATCH_SIZE)
  );

  let dispatched = 0;
  await Promise.all(
    batches.map(async (batch) => {
      const runIds = batch.map(({ runId }) => runId);
      try {
        await env.MailboxActionQueue.sendBatch(
          runIds.map((runId) => ({
            body: { runId },
            contentType: "json" as const,
          }))
        );
        dispatched += batch.length;
      } catch (error) {
        reportWorkerError(error, {
          category: "mailbox_action_dispatch_send_error",
          route: "scheduled",
        });
        await releaseClaims(runIds);
      }
    })
  );

  return { dispatched };
};

export default withSentryReporting({
  async scheduled(_event, env, _ctx) {
    try {
      await withRequestDatabaseClient(async () => {
        const results = await Promise.allSettled([
          dispatchPendingMailboxActionRuns(env),
          recoverMailSends(),
          cleanupMailObjects(),
          cleanupRateLimitBuckets(),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed !== undefined) {
          throw failed.reason;
        }
      });
    } catch (error) {
      reportWorkerError(error, {
        category: "mailbox_action_dispatch_error",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env>);
