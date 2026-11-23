import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import type { createMailUpdateResources } from "./mail-updates";
import {
  cloudflareWorkerBuild,
  cloudflareWorkerObservability,
} from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import { deploymentEnvironment, mailDispatchDomain } from "./stage";
import type { SecretBindings, SecretResources } from "./types";

export const createMailDispatchWorker = (input: {
  appDatabase: ReturnType<typeof createAppDatabase>;
  gmailProcessor: sst.cloudflare.Worker | undefined;
  maintenanceScript: $util.Output<string>;
  secretBindings: SecretBindings;
  secretResources: SecretResources;
  updates: ReturnType<typeof createMailUpdateResources>;
}) => {
  const repairQueue = new sst.cloudflare.Queue("MailDispatchRepairQueue");
  const worker = new sst.cloudflare.Worker("MailDispatchWorker", {
    build: cloudflareWorkerBuild,
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
    domain: mailDispatchDomain,
    environment: { QUIETER_DEPLOYMENT_ENV: deploymentEnvironment },
    handler: "packages/cloudflare/src/mail-dispatch-worker.ts",
    link: [
      input.appDatabase,
      input.updates.user,
      repairQueue,
      ...(input.gmailProcessor === undefined ? [] : [input.gmailProcessor]),
      requireSecretBinding(input.secretBindings, "SENTRY_DSN"),
      requireSecretResource(
        input.secretResources,
        "GMAIL_LIVE_SYNC_TOKEN_SECRET"
      ),
    ],
    transform: {
      worker(args) {
        args.bindings = $util
          .all([
            args.bindings,
            input.updates.worker.nodes.worker.scriptName,
            input.maintenanceScript,
          ])
          .apply(([bindings, updatesScript, maintenanceScript]) => [
            ...(bindings ?? []).map((binding) =>
              binding.name === "MailLiveUser"
                ? { ...binding, scriptName: updatesScript }
                : binding
            ),
            {
              name: "MAIL_MAINTENANCE",
              service: maintenanceScript,
              type: "service",
            },
          ]);
        args.observability = cloudflareWorkerObservability;
      },
    },
    url: true,
  });
  const { accountId, scriptName } = worker.nodes.worker;
  // oxlint-disable-next-line no-new -- Register a consumer on the existing Worker.
  new cloudflare.QueueConsumer("MailDispatchRepairConsumer", {
    accountId: repairQueue.nodes.queue.accountId.apply((id) => {
      if (id === undefined) {
        throw new Error(
          "Mail dispatch repair queue is missing its account ID."
        );
      }
      return id;
    }),
    queueId: repairQueue.id,
    scriptName,
    settings: {
      batchSize: 1,
      maxConcurrency: 4,
      maxRetries: 3,
      maxWaitTimeMs: 0,
      retryDelay: 30,
    },
    type: "worker",
  });
  return new cloudflare.WorkersCronTrigger("MailDispatchRepair", {
    accountId: accountId.apply((id) => {
      if (id === undefined) {
        throw new Error("Mail dispatch Worker is missing its account ID.");
      }
      return id;
    }),
    schedules: [{ cron: "*/5 * * * *" }],
    scriptName,
  });
};
