import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import { requireSecretBinding, requireSecretResource } from "./secrets";
import type { SecretBindings, SecretResources } from "./types";

export const createMailUpdateResources = (
  secretBindings: SecretBindings,
  secretResources: SecretResources,
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const user = new sst.cloudflare.DurableObject("MailLiveUser", {
    className: "MailLiveUser",
  });
  const worker = new sst.cloudflare.Worker("MailUpdatesWorker", {
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
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
    url: worker.url.apply((url) => {
      if (!url) {
        throw new Error("Mail updates URL is missing.");
      }
      return `${url.replace(/^http/u, "ws")}/mail/live`;
    }),
    user,
    worker,
  };
};
