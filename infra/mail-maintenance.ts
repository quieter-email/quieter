import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretBinding } from "./secrets";
import type { SecretBindings } from "./types";

export const createMailMaintenanceResources = (
  context: DeploymentContext,
  secretBindings: SecretBindings,
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const sentryDsnBinding = requireSecretBinding(secretBindings, "SENTRY_DSN");
  return new sst.cloudflare.Cron("MailMaintenance", {
    schedules: ["* * * * *"],
    worker: {
      compatibility: {
        date: COMPATIBILITY_DATE,
        flags: ["nodejs_compat"],
      },
      environment: {
        ...context.billingEnvironment,
        R2_ACCOUNT_ID: context.env.R2_ACCOUNT_ID ?? "",
        R2_BUCKET: context.env.R2_BUCKET ?? "",
        R2_ENDPOINT: context.env.R2_ENDPOINT ?? "",
      },
      handler: "packages/cloudflare/src/mail-maintenance-worker.ts",
      link: [
        appDatabase,
        sentryDsnBinding,
        ...(
          [
            "POLAR_ACCESS_TOKEN",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
          ] as const
        ).map((name) => requireSecretBinding(secretBindings, name)),
      ],
      transform: {
        worker(args) {
          args.observability = cloudflareWorkerObservability;
        },
      },
    },
  });
};
