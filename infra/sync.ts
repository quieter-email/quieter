import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import type { DeploymentContext } from "./runtime";
import { cloudflareWorkerObservability } from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import { deploymentEnvironment } from "./stage";
import type { SecretBindings, SecretResources } from "./types";

export const createMailSyncResources = (
  context: DeploymentContext,
  secretBindings: SecretBindings,
  secretResources: SecretResources,
  database: ReturnType<typeof createAppDatabase>
) => {
  const secret = requireSecretResource(secretResources, "MAIL_SYNC_SECRET");
  if (context.env.QUIETER_MAIL_SYNC_ENABLED !== true) {
    return {
      environment: { MAIL_SYNC_URL: "", QUIETER_MAIL_SYNC_ENABLED: "false" },
      secret,
      url: null,
    };
  }
  const mailboxObjects = new sst.cloudflare.DurableObject(
    "MailboxSyncObjects",
    { className: "MailboxSync" }
  );
  const userObjects = new sst.cloudflare.DurableObject("UserSyncObjects", {
    className: "UserSync",
  });
  const bodies = new sst.cloudflare.Bucket("SyncBodies");
  const deadLetters = new sst.cloudflare.Queue("MailSyncDeadLetters");
  const queue = new sst.cloudflare.Queue("MailSyncQueue");
  const worker = new sst.cloudflare.Worker("MailSyncWorker", {
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
    environment: {
      ...context.billingEnvironment,
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "false",
      SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
    },
    handler: "packages/sync-worker/src/worker.ts",
    link: [
      database,
      bodies,
      mailboxObjects,
      userObjects,
      queue,
      secret,
      ...(
        [
          "GMAIL_TOKEN_ENCRYPTION_KEY",
          "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT",
          "GOOGLE_GMAIL_CLIENT_ID",
          "GOOGLE_GMAIL_CLIENT_SECRET",
          "SENTRY_DSN",
          "POLAR_ACCESS_TOKEN",
        ] as const
      ).map((name) => requireSecretBinding(secretBindings, name)),
    ],
    migrations: [
      {
        newSqliteClasses: [mailboxObjects.className, userObjects.className],
        tag: "v1",
      },
    ],
    transform: {
      worker(args) {
        args.limits = { cpuMs: 300_000 };
        args.observability = {
          ...cloudflareWorkerObservability,
          logs: {
            ...cloudflareWorkerObservability.logs,
            invocationLogs: false,
          },
          traces: { ...cloudflareWorkerObservability.traces, enabled: false },
        };
      },
    },
    url: true,
  });
  const accountId = worker.nodes.worker.accountId.apply((value) => {
    if (value === undefined) {
      throw new Error("MailSyncWorker account is unavailable.");
    }
    return value;
  });
  const consumer = new cloudflare.QueueConsumer("MailSyncConsumer", {
    accountId,
    deadLetterQueue: deadLetters.nodes.queue.queueName,
    queueId: queue.id,
    scriptName: worker.nodes.worker.scriptName,
    settings: {
      batchSize: 1,
      maxConcurrency: 5,
      maxRetries: 10,
      maxWaitTimeMs: 0,
      retryDelay: 5000,
    },
    type: "worker",
  });
  const maintenance = new cloudflare.WorkersCronTrigger("MailSyncMaintenance", {
    accountId,
    schedules: [{ cron: "* * * * *" }],
    scriptName: worker.nodes.worker.scriptName,
  });
  void consumer;
  void maintenance;
  const url = worker.url.apply((value) => {
    if (value === undefined || value === "") {
      throw new Error("MailSyncWorker did not expose a URL.");
    }
    return value;
  });
  return {
    environment: { MAIL_SYNC_URL: url, QUIETER_MAIL_SYNC_ENABLED: "true" },
    secret,
    url,
  };
};
