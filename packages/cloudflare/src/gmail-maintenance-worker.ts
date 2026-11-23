import { withRequestDatabaseClient } from "@quieter/database/client";
import { claimGmailSchedulerRepairs } from "@quieter/orpc/gmail-pubsub";
import { pruneCompletedGmailMessageWork } from "@quieter/orpc/gmail-work";

import { sendGmailProcessingJob } from "./gmail-processing";
import { reportWorkerError, withSentryReporting } from "./worker-runtime";

export const runGmailMaintenance = async (
  env: Pick<Env, "GmailProcessingWorker">,
  dependencies: {
    claimRepairs?: typeof claimGmailSchedulerRepairs;
    pruneWork?: typeof pruneCompletedGmailMessageWork;
  } = {}
) => {
  const jobs = await withRequestDatabaseClient(
    async () =>
      await (dependencies.claimRepairs ?? claimGmailSchedulerRepairs)()
  );
  let maintained = 0;
  for (let index = 0; index < jobs.length; index += 25) {
    const accepted = await Promise.all(
      jobs.slice(index, index + 25).map(async ({ mailboxId }) => {
        try {
          const decision = await sendGmailProcessingJob(env, {
            kind: "maintain",
            mailboxId,
          });
          if (decision.action !== "ack") {
            throw new Error("Gmail mailbox repair was not accepted.");
          }
          return true;
        } catch (error) {
          reportWorkerError(error, {
            category: "gmail_maintenance_mailbox_error",
            route: "scheduled",
          });
          return false;
        }
      })
    );
    maintained += accepted.filter(Boolean).length;
  }
  await withRequestDatabaseClient(async () => {
    await (dependencies.pruneWork ?? pruneCompletedGmailMessageWork)();
  });
  return { failed: jobs.length - maintained, maintained, scanned: jobs.length };
};

export default withSentryReporting({
  async scheduled(_event, env, _ctx) {
    await runGmailMaintenance(env);
  },
} satisfies ExportedHandler<Env>);
