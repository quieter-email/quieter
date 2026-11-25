import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { listDueGmailMailboxAutomation } from "@quieter/orpc/gmail-mailbox-automation/readiness";
import { claimGmailSchedulerRepairs } from "@quieter/orpc/gmail-pubsub";

import { gmailAutomationTasks } from "./gmail-mailbox-scheduler";
import { sendGmailProcessingJob } from "./gmail-processing";
import type { GmailJob } from "./gmail-processing-job";
import { reportWorkerError, withSentryReporting } from "./worker-runtime";

export const runGmailMaintenance = async (
  env: Pick<Env, "GmailProcessingWorker">,
  dependencies: {
    claimRepairs?: typeof claimGmailSchedulerRepairs;
    listAutomation?: (
      input: Parameters<typeof listDueGmailMailboxAutomation>[0]
    ) => Promise<{ mailboxId: string; nextWakeAt: number }[]>;
  } = {}
) => {
  const jobs = await withRequestDatabaseClient(async () => {
    const [repairs, ...automation] = await Promise.all([
      (dependencies.claimRepairs ?? claimGmailSchedulerRepairs)(),
      ...gmailAutomationTasks.map(async (kind) => ({
        due: await (
          dependencies.listAutomation ?? listDueGmailMailboxAutomation
        )({ kind }),
        kind,
      })),
    ]);
    const dueTasks = new Map<string, (typeof gmailAutomationTasks)[number][]>();
    for (const { kind, due } of automation) {
      for (const { mailboxId } of due) {
        const tasks = dueTasks.get(mailboxId) ?? [];
        tasks.push(kind);
        dueTasks.set(mailboxId, tasks);
      }
    }
    return [
      ...repairs.map(
        ({ mailboxId }) => ({ kind: "maintain", mailboxId }) as const
      ),
      ...[...dueTasks.entries()].map(
        ([mailboxId, tasks]) =>
          ({ kind: "automation", mailboxId, tasks }) as const
      ),
    ] satisfies GmailJob[];
  });
  let maintained = 0;
  for (let index = 0; index < jobs.length; index += 25) {
    const accepted = await Promise.all(
      jobs.slice(index, index + 25).map(async (job) => {
        try {
          const decision = await sendGmailProcessingJob(env, job);
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
  return { failed: jobs.length - maintained, maintained, scanned: jobs.length };
};

export default withSentryReporting({
  async scheduled(_event, env, _ctx) {
    if (serverEnv.QUIETER_GMAIL_EVENTS_ENABLED === true) {
      return;
    }
    await runGmailMaintenance(env);
  },
} satisfies ExportedHandler<Env>);
