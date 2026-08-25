import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
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
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const gmailLiveSyncTokenSecret = requireSecretResource(
    secretResources,
    "GMAIL_LIVE_SYNC_TOKEN_SECRET"
  );
  let gmailLiveSyncUrl: $util.Input<string> = "";
  let gmailPubSubIngressUrl: $util.Output<string> | null = null;

  if (context.gmailPubSubEnabled) {
    const gmailPubSubDeadLetterQueue = new sst.cloudflare.Queue("GmailPsDlq");
    const gmailPubSubQueue = new sst.cloudflare.Queue("GmailPsQueue", {
      dlq: {
        queue: gmailPubSubDeadLetterQueue.nodes.queue.queueName,
        retry: 10,
        retryDelay: "30 seconds",
      },
      maxConcurrency: 20,
    });
    const gmailLiveSyncMailbox = new sst.cloudflare.DurableObject(
      "GmailLiveSyncMailbox",
      {
        className: "GmailLiveSyncMailbox",
      }
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
        },
        handler: "packages/cloudflare/src/worker.ts",
        link: [
          gmailLiveSyncMailbox,
          gmailLiveSyncTokenSecret,
          gmailPubSubQueue,
        ],
        migrations: [
          {
            newSqliteClasses: [gmailLiveSyncMailbox.className],
            tag: "v1",
          },
        ],
        transform: {
          worker(args) {
            args.observability = cloudflareWorkerObservability;
          },
        },
        url: true,
      }
    );

    const processingSecretBindings = processingSecretNames.map((name) =>
      requireSecretBinding(secretBindings, name)
    );
    gmailPubSubQueue.subscribe(
      {
        compatibility: {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        },
        environment: {
          GMAIL_PUBSUB_TOPIC: context.gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
          POLAR_ORGANIZATION_ID: context.polarOrganizationId,
          POLAR_SANDBOX: context.polarSandbox,
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
          SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
        },
        handler: "packages/cloudflare/src/queue-worker.ts",
        link: [appDatabase, gmailLiveSyncMailbox, ...processingSecretBindings],
        transform: {
          worker(args) {
            args.limits = { cpuMs: 300_000 };
            args.observability = cloudflareWorkerObservability;
          },
        },
      },
      {
        batch: {
          size: 1,
          window: "0 seconds",
        },
      }
    );

    const gmailPubSubMaintenance = new sst.cloudflare.Cron(
      "GmailPubSubMaintenance",
      {
        schedules: ["*/15 * * * *"],
        worker: {
          compatibility: {
            date: COMPATIBILITY_DATE,
            flags: ["nodejs_compat"],
          },
          handler: "packages/cloudflare/src/gmail-maintenance-worker.ts",
          link: [appDatabase, gmailPubSubQueue],
          transform: {
            worker(args) {
              args.observability = cloudflareWorkerObservability;
            },
          },
        },
      }
    );
    void gmailPubSubMaintenance;

    gmailLiveSyncUrl = gmailRealtimeWorker.url.apply((url) => {
      if (url === undefined || url === "") {
        throw new Error("GmailRealtimeWorker did not expose a URL");
      }

      return `${url.replace(/^http/u, "ws")}/gmail/live`;
    });
    gmailPubSubIngressUrl = gmailRealtimeWorker.url.apply((url) => {
      if (url === undefined || url === "") {
        throw new Error("GmailRealtimeWorker did not expose a URL");
      }

      return `${url}/gmail/pubsub`;
    });
  }

  return {
    gmailLiveSyncUrl,
    gmailPubSubIngressUrl,
  };
};
