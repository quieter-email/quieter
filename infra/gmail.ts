import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
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
  let gmailPubSubIngressUrl: $util.Output<string> | null = null;

  if (context.gmailPubSubEnabled) {
    const sentryDsnBinding = requireSecretBinding(secretBindings, "SENTRY_DSN");
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
          ...context.billingEnvironment,
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
          SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
        },
        handler: "packages/cloudflare/src/worker.ts",
        link: [
          gmailLiveSyncMailbox,
          mailLiveUser,
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
                  binding.name === "MailLiveUser"
                    ? { ...binding, scriptName }
                    : binding
                )
              );
            args.limits = { cpuMs: 300_000 };
            args.observability = cloudflareWorkerObservability;
          },
        },
        url: true,
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
          environment: {
            GMAIL_PUBSUB_TOPIC:
              context.gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
            ...context.billingEnvironment,
            QUIETER_GMAIL_AI_AUTOMATION_ENABLED:
              context.mailAutomationAiEnabled,
            SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
          },
          handler: "packages/cloudflare/src/gmail-maintenance-worker.ts",
          link: [
            appDatabase,
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
    void gmailPubSubMaintenance;

    gmailLiveSyncUrl = gmailRealtimeWorker.url.apply((url) =>
      url ? `${url.replace(/^http/u, "ws")}/gmail/live` : ""
    );
    gmailPubSubIngressUrl = gmailRealtimeWorker.url.apply((url) =>
      url ? `${url}/gmail/pubsub` : ""
    );
  }

  return {
    gmailLiveSyncUrl,
    gmailPubSubIngressUrl,
  };
};
