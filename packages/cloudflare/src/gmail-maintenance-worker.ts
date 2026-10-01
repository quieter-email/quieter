import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  listGmailPubSubMaintenanceJobs,
  maintainGmailPubSubMailbox,
} from "@quieter/orpc/gmail-pubsub";

import { broadcastGmailUpdate } from "./mail-updates";
import { reportWorkerError, withSentryReporting } from "./worker-runtime";

const CONCURRENCY = 4;

export const runGmailMaintenance = async (
  env: Env,
  dependencies: {
    listJobs?: typeof listGmailPubSubMaintenanceJobs;
    maintainMailbox?: typeof maintainGmailPubSubMailbox;
  } = {}
) => {
  const jobs = await withRequestDatabaseClient(
    async () =>
      await (dependencies.listJobs ?? listGmailPubSubMaintenanceJobs)()
  );
  let nextIndex = 0;
  let maintained = 0;
  let busy = 0;
  const failures: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (nextIndex < jobs.length) {
        const job = jobs[nextIndex];
        nextIndex += 1;
        if (job === undefined) {
          break;
        }
        try {
          const result = await withRequestDatabaseClient(
            async () =>
              await (
                dependencies.maintainMailbox ?? maintainGmailPubSubMailbox
              )({
                mailboxId: job.mailboxId,
                topicName: env.GMAIL_PUBSUB_TOPIC,
              })
          );
          if (result.status === "busy") {
            busy += 1;
          } else if (result.status === "maintained") {
            maintained += 1;
            await broadcastGmailUpdate(
              env,
              job.emailAddress,
              "mailbox.changed"
            );
          }
        } catch (error) {
          failures.push(error);
          reportWorkerError(error, {
            category: "gmail_maintenance_mailbox_error",
            route: "scheduled",
          });
        }
      }
    })
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Gmail maintenance failed for some mailboxes."
    );
  }
  return { busy, maintained, scanned: jobs.length };
};

export default withSentryReporting({
  async scheduled(_event, env, _ctx) {
    await runGmailMaintenance(env);
  },
} satisfies ExportedHandler<Env>);
