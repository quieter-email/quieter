import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import { production, stage } from "./stage";
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
  const worker = new sst.cloudflare.Worker("MailUpdatesWorker", {
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
    domain,
    handler: "packages/cloudflare/src/mail-update-worker.ts",
    link: [
      user,
      appDatabase,
      requireSecretResource(secretResources, "GMAIL_LIVE_SYNC_TOKEN_SECRET"),
      requireSecretBinding(secretBindings, "SENTRY_DSN"),
    ],
    migrations: [{ newSqliteClasses: [user.className], tag: "v1" }],
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
    url: `wss://${domain}/mail/live`,
    user,
    worker,
  };
};
