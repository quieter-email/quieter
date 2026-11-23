import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";
import {
  GMAIL_EXECUTOR_CLASSES,
  GMAIL_EXECUTOR_SHARDS,
} from "@quieter/cloudflare/gmail-processing-config";

import type { createAppDatabase } from "./database";
import { GMAIL_PROCESSING_REGION } from "./gmail-processing-region";
import type { createMailUpdateResources } from "./mail-updates";
import {
  cloudflareWorkerBuild,
  cloudflareWorkerObservability,
} from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import type { SecretBindings, SecretResources } from "./types";

const processingSecretNames = [
  "CONNECTOR_TOKEN_ENCRYPTION_KEY",
  "GMAIL_BODY_ENCRYPTION_KEY",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "NOTION_CLIENT_ID",
  "NOTION_CLIENT_SECRET",
  "TODOIST_CLIENT_ID",
  "TODOIST_CLIENT_SECRET",
  "CLICKUP_CLIENT_ID",
  "CLICKUP_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "QUIETER_BACKGROUND_MODEL",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
  "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT",
  "GOOGLE_GMAIL_CLIENT_ID",
  "GOOGLE_GMAIL_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
  "POLAR_ACCESS_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

export const createGmailResources = (
  context: DeploymentContext,
  secretBindings: SecretBindings,
  secretResources: SecretResources,
  appDatabase: ReturnType<typeof createAppDatabase>,
  updates: ReturnType<typeof createMailUpdateResources>
) => {
  const gmailLiveSyncTokenSecret = requireSecretResource(
    secretResources,
    "GMAIL_LIVE_SYNC_TOKEN_SECRET"
  );
  let gmailLiveSyncUrl: $util.Input<string> = "";
  let actionWorkers: {
    gmailProcessing: $util.Output<string>;
    gmailRealtime: $util.Output<string>;
    gmailMaintenance: $util.Output<string>;
  } | null = null;
  let gmailPubSubIngressUrl: $util.Output<string> | null = null;
  let gmailProcessingQueues: {
    deadLetter: $util.Output<string>;
    pending: $util.Output<string>;
    executors: $util.Output<string>[];
    fresh: $util.Output<string>;
    catchup: $util.Output<string>;
  } | null = null;

  if (context.gmailPubSubEnabled) {
    const sentryDsnBinding = requireSecretBinding(secretBindings, "SENTRY_DSN");
    const gmailProcessingDeadLetterQueue = new sst.cloudflare.Queue(
      "GmailProcessingDeadLetterQueue"
    );
    const gmailProcessingQueue = new sst.cloudflare.Queue(
      "GmailProcessingQueue"
    );
    const gmailFreshProcessingQueue = new sst.cloudflare.Queue(
      "GmailFreshProcessingQueue"
    );
    const gmailCatchupProcessingQueue = new sst.cloudflare.Queue(
      "GmailCatchupProcessingQueue"
    );
    const gmailFreshExecutor = new sst.cloudflare.DurableObject(
      "GmailFreshExecutor",
      { className: "GmailFreshExecutor" }
    );
    const gmailProjectQuota = new sst.cloudflare.DurableObject(
      "GmailProjectQuota",
      { className: "GmailProjectQuota" }
    );
    const gmailMailboxScheduler = new sst.cloudflare.DurableObject(
      "GmailMailboxScheduler",
      { className: "GmailMailboxScheduler" }
    );
    const executorQueues = GMAIL_EXECUTOR_CLASSES.flatMap((lane) =>
      GMAIL_EXECUTOR_SHARDS.map(
        (shard) => new sst.cloudflare.Queue(`GmailMailbox${lane}Queue${shard}`)
      )
    );
    // Production already applied v1 (old class) and v2 (delete), so the class
    // returns under a new name in v3.
    const gmailLiveSyncMailbox = new sst.cloudflare.DurableObject(
      "GmailLiveSyncMailboxV2",
      {
        className: "GmailLiveSyncMailboxV2",
      }
    );
    const mailLiveUser = updates.user;
    const processingSecretBindings = processingSecretNames.map((name) =>
      requireSecretBinding(secretBindings, name)
    );
    const gmailProcessingWorker = new sst.cloudflare.Worker(
      "GmailProcessingWorker",
      {
        build: {
          esbuild: {
            ...cloudflareWorkerBuild.esbuild,
            conditions: ["workerd", "worker", "module", "node"],
          },
        },
        compatibility: {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        },
        environment: {
          GMAIL_BODY_STORAGE_ENABLED: String(
            context.env.GMAIL_BODY_STORAGE_ENABLED ?? false
          ),
          GMAIL_PUBSUB_TOPIC: context.gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
          MAIL_UPDATES_URL: updates.url,
          ...context.billingEnvironment,
          ...context.releaseEnvironment,
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
          QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE: String(
            context.env.QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE ?? ""
          ),
          QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE: String(
            context.env.QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE
          ),
          R2_ACCOUNT_ID: context.env.R2_ACCOUNT_ID ?? "",
          R2_BUCKET: context.env.R2_BUCKET ?? "",
          R2_ENDPOINT: context.env.R2_ENDPOINT ?? "",
          SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
        },
        handler: "packages/cloudflare/src/gmail-processing-worker.ts",
        link: [
          gmailFreshExecutor,
          gmailMailboxScheduler,
          gmailProjectQuota,
          ...executorQueues,
          mailLiveUser,
          appDatabase,
          sentryDsnBinding,
          requireSecretBinding(secretBindings, "GMAIL_LIVE_SYNC_TOKEN_SECRET"),
          ...processingSecretBindings,
        ],
        migrations: [
          { newSqliteClasses: [gmailFreshExecutor.className], tag: "fresh-v1" },
          {
            newSqliteClasses: [gmailMailboxScheduler.className],
            tag: "mailbox-scheduler-v1",
          },
          {
            newSqliteClasses: [gmailProjectQuota.className],
            tag: "gmail-quota-v1",
          },
        ],
        placement: { region: GMAIL_PROCESSING_REGION },
        transform: {
          worker(args) {
            args.bindings = $util
              .all([args.bindings, updates.worker.nodes.worker.scriptName])
              .apply(([bindings, scriptName]) =>
                (bindings ?? []).map((binding) =>
                  binding.name === "MailLiveUser"
                    ? { ...binding, scriptName }
                    : binding
                )
              );
            args.limits = { cpuMs: 300_000 };
            args.observability = cloudflareWorkerObservability;
          },
        },
        url: false,
      }
    );
    const gmailProcessingPrivateUrls = new cloudflare.WorkersScriptSubdomain(
      "GmailProcessingPrivateUrls",
      {
        accountId: gmailProcessingWorker.nodes.worker.accountId.apply(
          (accountId) => {
            if (accountId === undefined) {
              throw new Error("Gmail processor is missing its account ID.");
            }
            return accountId;
          }
        ),
        enabled: false,
        previewsEnabled: false,
        scriptName: gmailProcessingWorker.nodes.worker.scriptName,
      },
      { dependsOn: [gmailProcessingWorker] }
    );
    const gmailRealtimeWorker = new sst.cloudflare.Worker(
      "GmailRealtimeWorker",
      {
        build: cloudflareWorkerBuild,
        compatibility: {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        },
        environment: {
          GMAIL_PUBSUB_PUSH_AUDIENCE:
            context.gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE,
          GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
            context.gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
          GMAIL_PUBSUB_SUBSCRIPTION:
            context.gmailPubSubEnvironment.GMAIL_PUBSUB_SUBSCRIPTION,
          GMAIL_PUBSUB_TOPIC: context.gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
          MAIL_UPDATES_URL: updates.url,
          ...context.billingEnvironment,
          ...context.releaseEnvironment,
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
          SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
        },
        handler: "packages/cloudflare/src/worker.ts",
        link: [
          gmailProcessingWorker,
          gmailProcessingQueue,
          gmailFreshProcessingQueue,
          gmailCatchupProcessingQueue,
          gmailLiveSyncMailbox,
          mailLiveUser,
          updates.reminders,
          updates.scheduledSends,
          gmailLiveSyncTokenSecret,
          appDatabase,
          sentryDsnBinding,
        ],
        migrations: [
          { newSqliteClasses: ["GmailLiveSyncMailbox"], tag: "v1" },
          { deletedClasses: ["GmailLiveSyncMailbox"], tag: "v2" },
          {
            newSqliteClasses: [gmailLiveSyncMailbox.className],
            tag: "v3",
          },
        ],
        transform: {
          worker(args) {
            args.bindings = $util
              .all([args.bindings, updates.worker.nodes.worker.scriptName])
              .apply(([bindings, scriptName]) =>
                (bindings ?? []).map((binding) =>
                  binding.name === "MailLiveUser" ||
                  binding.name === "ReminderMailbox" ||
                  binding.name === "ScheduledSend"
                    ? { ...binding, scriptName }
                    : binding
                )
              );
            args.limits = { cpuMs: 300_000 };
            args.observability = cloudflareWorkerObservability;
          },
        },
        url: true,
      },
      { dependsOn: [gmailProcessingWorker, gmailProcessingPrivateUrls] }
    );

    for (const [name, queue, worker, legacyConcurrency] of [
      ["GmailProcessingConsumer", gmailProcessingQueue, gmailRealtimeWorker, 2],
      [
        "GmailFreshProcessingConsumer",
        gmailFreshProcessingQueue,
        gmailRealtimeWorker,
        4,
      ],
      [
        "GmailCatchupProcessingConsumer",
        gmailCatchupProcessingQueue,
        gmailRealtimeWorker,
        8,
      ],
      ...executorQueues.map(
        (executorQueue, index) =>
          [
            `GmailMailboxExecutorConsumer${index}`,
            executorQueue,
            gmailProcessingWorker,
          ] as const
      ),
    ] as const) {
      // oxlint-disable-next-line no-new -- Register a consumer on its existing worker.
      new cloudflare.QueueConsumer(name, {
        accountId: queue.nodes.queue.accountId.apply((accountId) => {
          if (accountId === undefined) {
            throw new Error(
              "Gmail processing queue is missing its account ID."
            );
          }
          return accountId;
        }),
        deadLetterQueue: gmailProcessingDeadLetterQueue.nodes.queue.queueName,
        queueId: queue.id,
        scriptName: worker.nodes.worker.scriptName,
        settings: {
          batchSize: 1,
          maxConcurrency: legacyConcurrency,
          maxRetries: legacyConcurrency === undefined ? 8 : 100,
          maxWaitTimeMs: 0,
          retryDelay: 60,
        },
        type: "worker",
      });
    }
    gmailProcessingQueues = {
      catchup: gmailCatchupProcessingQueue.nodes.queue.queueName,
      deadLetter: gmailProcessingDeadLetterQueue.nodes.queue.queueName,
      executors: executorQueues.map((queue) => queue.nodes.queue.queueName),
      fresh: gmailFreshProcessingQueue.nodes.queue.queueName,
      pending: gmailProcessingQueue.nodes.queue.queueName,
    };

    const gmailPubSubMaintenance = new sst.cloudflare.Cron(
      "GmailPubSubMaintenance",
      {
        schedules: ["* * * * *"],
        worker: {
          build: cloudflareWorkerBuild,
          compatibility: {
            date: COMPATIBILITY_DATE,
            flags: ["nodejs_compat"],
          },
          environment: {
            ...context.releaseEnvironment,
            SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
          },
          handler: "packages/cloudflare/src/gmail-maintenance-worker.ts",
          link: [appDatabase, gmailProcessingWorker, sentryDsnBinding],
          transform: {
            worker(args) {
              args.limits = { cpuMs: 300_000 };
              args.observability = cloudflareWorkerObservability;
            },
          },
        },
      }
    );
    actionWorkers = {
      gmailMaintenance: gmailPubSubMaintenance.nodes.worker.scriptName,
      gmailProcessing: gmailProcessingWorker.nodes.worker.scriptName,
      gmailRealtime: gmailRealtimeWorker.nodes.worker.scriptName,
    };

    gmailLiveSyncUrl = gmailRealtimeWorker.url.apply((url) =>
      url ? `${url.replace(/^http/u, "ws")}/gmail/live` : ""
    );
    gmailPubSubIngressUrl = gmailRealtimeWorker.url.apply((url) =>
      url ? `${url}/gmail/pubsub` : ""
    );
  }

  return {
    actionWorkers,
    gmailLiveSyncUrl,
    gmailProcessingQueues,
    gmailPubSubIngressUrl,
  };
};
