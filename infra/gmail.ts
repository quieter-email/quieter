import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { GMAIL_PROCESSING_REGION } from "./gmail-processing-region";
import type { createMailUpdateResources } from "./mail-updates";
import { cloudflareWorkerObservability } from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import type { SecretBindings, SecretResources } from "./types";

const processingSecretNames = [
  "GMAIL_TOKEN_ENCRYPTION_KEY",
  "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT",
  "GOOGLE_GMAIL_CLIENT_ID",
  "GOOGLE_GMAIL_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
  "POLAR_ACCESS_TOKEN",
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
        compatibility: {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        },
        environment: {
          ...context.billingEnvironment,
          ...context.releaseEnvironment,
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
          SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
        },
        handler: "packages/cloudflare/src/gmail-processing-worker.ts",
        link: [
          gmailProcessingQueue,
          gmailFreshProcessingQueue,
          gmailCatchupProcessingQueue,
          gmailFreshExecutor,
          mailLiveUser,
          appDatabase,
          sentryDsnBinding,
          ...processingSecretBindings,
        ],
        migrations: [
          { newSqliteClasses: [gmailFreshExecutor.className], tag: "fresh-v1" },
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
          ...processingSecretBindings,
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

    // oxlint-disable-next-line no-new -- Pulumi registers this consumer with the existing realtime Worker.
    new cloudflare.QueueConsumer("GmailProcessingConsumer", {
      accountId: gmailProcessingQueue.nodes.queue.accountId.apply(
        (accountId) => {
          if (accountId === undefined) {
            throw new Error(
              "Gmail processing queue is missing its account ID."
            );
          }
          return accountId;
        }
      ),
      deadLetterQueue: gmailProcessingDeadLetterQueue.nodes.queue.queueName,
      queueId: gmailProcessingQueue.id,
      scriptName: gmailRealtimeWorker.nodes.worker.scriptName,
      settings: {
        batchSize: 1,
        maxConcurrency: 2,
        maxRetries: 100,
        maxWaitTimeMs: 0,
        retryDelay: 60,
      },
      type: "worker",
    });
    for (const [name, queue, maxConcurrency] of [
      ["GmailFreshProcessingConsumer", gmailFreshProcessingQueue, 4],
      ["GmailCatchupProcessingConsumer", gmailCatchupProcessingQueue, 2],
    ] as const) {
      // oxlint-disable-next-line no-new -- Pulumi registers each independent consumer with the realtime Worker.
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
        scriptName: gmailRealtimeWorker.nodes.worker.scriptName,
        settings: {
          batchSize: 1,
          maxConcurrency,
          maxRetries: 100,
          maxWaitTimeMs: 0,
          retryDelay: 60,
        },
        type: "worker",
      });
    }
    gmailProcessingQueues = {
      catchup: gmailCatchupProcessingQueue.nodes.queue.queueName,
      deadLetter: gmailProcessingDeadLetterQueue.nodes.queue.queueName,
      fresh: gmailFreshProcessingQueue.nodes.queue.queueName,
      pending: gmailProcessingQueue.nodes.queue.queueName,
    };

    const gmailPubSubMaintenance = new sst.cloudflare.Cron(
      "GmailPubSubMaintenance",
      {
        schedules: ["*/15 * * * *"],
        worker: {
          compatibility: {
            date: COMPATIBILITY_DATE,
            flags: ["nodejs_compat"],
          },
          environment: {
            GMAIL_PUBSUB_TOPIC:
              context.gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
            ...context.billingEnvironment,
            ...context.releaseEnvironment,
            QUIETER_GMAIL_AI_AUTOMATION_ENABLED:
              context.mailAutomationAiEnabled,
            SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
          },
          handler: "packages/cloudflare/src/gmail-maintenance-worker.ts",
          link: [
            appDatabase,
            gmailFreshProcessingQueue,
            gmailCatchupProcessingQueue,
            mailLiveUser,
            sentryDsnBinding,
            ...processingSecretBindings,
          ],
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
