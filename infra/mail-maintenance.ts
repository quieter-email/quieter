import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import {
  cloudflareWorkerBuild,
  cloudflareWorkerObservability,
} from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretBinding } from "./secrets";
import type { SecretBindings } from "./types";

export const createMailMaintenanceResources = (
  context: DeploymentContext,
  secretBindings: SecretBindings,
  appDatabase: ReturnType<typeof createAppDatabase>,
  updatesUrl: $util.Input<string>
) => {
  const sentryDsnBinding = requireSecretBinding(secretBindings, "SENTRY_DSN");
  const eventsEnabled =
    context.env.QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED === true;
  const scheduler = new sst.cloudflare.DurableObject(
    "MailMaintenanceScheduler",
    {
      className: "MailMaintenanceScheduler",
    }
  );
  const worker = new sst.cloudflare.Worker("MailMaintenanceHandler", {
    build: {
      esbuild: {
        ...cloudflareWorkerBuild.esbuild,
        // SST bundles for Node; browser exports mix AWS SDK stubs with Node runtimeConfig.
        conditions: ["workerd", "worker", "module", "node"],
      },
    },
    compatibility: {
      date: COMPATIBILITY_DATE,
      flags: ["nodejs_compat"],
    },
    environment: {
      ...context.billingEnvironment,
      ...context.releaseEnvironment,
      GMAIL_BODY_STORAGE_ENABLED: String(
        context.env.GMAIL_BODY_STORAGE_ENABLED ?? false
      ),
      MAIL_UPDATES_URL: updatesUrl,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
      QUIETER_GMAIL_MAILBOX_LANES: String(context.gmailPubSubEnabled),
      QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED: String(eventsEnabled),
      R2_ACCOUNT_ID: context.env.R2_ACCOUNT_ID ?? "",
      R2_BUCKET: context.env.R2_BUCKET ?? "",
      R2_ENDPOINT: context.env.R2_ENDPOINT ?? "",
    },
    handler: "packages/cloudflare/src/mail-maintenance-worker.ts",
    link: [
      scheduler,
      appDatabase,
      sentryDsnBinding,
      ...(
        [
          "GMAIL_LIVE_SYNC_TOKEN_SECRET",
          "CONNECTOR_TOKEN_ENCRYPTION_KEY",
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
          "POLAR_ACCESS_TOKEN",
          "OPENROUTER_API_KEY",
          "QUIETER_BACKGROUND_MODEL",
          "GMAIL_TOKEN_ENCRYPTION_KEY",
          "GMAIL_BODY_ENCRYPTION_KEY",
          "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT",
          "GOOGLE_GMAIL_CLIENT_ID",
          "GOOGLE_GMAIL_CLIENT_SECRET",
          "R2_ACCESS_KEY_ID",
          "R2_SECRET_ACCESS_KEY",
        ] as const
      ).map((name) => requireSecretBinding(secretBindings, name)),
    ],
    migrations: [
      { newSqliteClasses: [scheduler.className], tag: "maintenance-v1" },
    ],
    transform: {
      worker(args) {
        args.observability = cloudflareWorkerObservability;
      },
    },
    url: false,
  });
  const { scriptName } = worker.nodes.worker;
  const accountId = worker.nodes.worker.accountId.apply((id) => {
    if (id === undefined) {
      throw new Error("Mail maintenance worker is missing its account ID.");
    }
    return id;
  });
  const privateUrls = new cloudflare.WorkersScriptSubdomain(
    "MailMaintenancePrivateUrls",
    {
      accountId,
      enabled: false,
      previewsEnabled: false,
      scriptName,
    },
    { dependsOn: [worker] }
  );
  const fallbackTrigger = eventsEnabled
    ? undefined
    : new cloudflare.WorkersCronTrigger(
        "MailMaintenanceFallbackTrigger",
        {
          accountId,
          schedules: [{ cron: "* * * * *" }],
          scriptName,
        },
        {
          aliases: [
            {
              name: "MailMaintenanceTrigger",
              parent: $util.createUrn("MailMaintenance", "sst:cloudflare:Cron"),
            },
          ],
        }
      );
  return { fallbackTrigger, privateUrls, worker };
};
