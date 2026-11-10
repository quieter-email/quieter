import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import { appOrigin, deploymentEnvironment, production, stage } from "./stage";
import type { SecretBindings, SecretResources } from "./types";

export const createMailUpdateResources = (
  secretBindings: SecretBindings,
  secretResources: SecretResources,
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const domain = production
    ? "updates.quieter.email"
    : `${stage}-updates.quieter.email`;
  const user = new sst.cloudflare.DurableObject("MailLiveUser", {
    className: "MailLiveUser",
  });
  const reminders = new sst.cloudflare.DurableObject("ReminderMailbox", {
    className: "ReminderMailbox",
  });
  const scheduledSends = new sst.cloudflare.DurableObject("ScheduledSend", {
    className: "ScheduledSend",
  });
  const worker = new sst.cloudflare.Worker("MailUpdatesWorker", {
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
    domain,
    environment: {
      BETTER_AUTH_URL: appOrigin,
      MAIL_UPDATES_URL: `wss://${domain}/mail/live`,
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      SENTRY_ENVIRONMENT: stage,
    },
    handler: "packages/cloudflare/src/mail-update-worker.ts",
    link: [
      user,
      reminders,
      scheduledSends,
      appDatabase,
      requireSecretResource(secretResources, "GMAIL_LIVE_SYNC_TOKEN_SECRET"),
      requireSecretBinding(secretBindings, "GMAIL_LIVE_SYNC_TOKEN_SECRET"),
      requireSecretBinding(secretBindings, "SENTRY_DSN"),
    ],
    migrations: [
      { newSqliteClasses: [user.className], tag: "v1" },
      { newSqliteClasses: [reminders.className], tag: "reminders-v1" },
      {
        newSqliteClasses: [scheduledSends.className],
        tag: "scheduled-send-v1",
      },
    ],
    transform: {
      worker(args) {
        args.observability = {
          ...cloudflareWorkerObservability,
          logs: {
            ...cloudflareWorkerObservability.logs,
            invocationLogs: false,
          },
        };
      },
    },
    url: true,
  });
  return {
    reminders,
    scheduledSends,
    url: worker.url.apply(() => `wss://${domain}/mail/live`),
    user,
    worker,
  };
};
