import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";
import { siteHostname } from "@quieter/env/hosts";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import {
  deploymentEnvironment,
  getEnvironmentValue,
  production,
  stage,
} from "./stage";
import { createQuieterTanStackStart } from "./tanstack-start";

const sitePath = "apps/site";
const SiteWorker = createQuieterTanStackStart(sitePath);

export const createSite = (appDatabase: ReturnType<typeof createAppDatabase>) =>
  new SiteWorker("Site", {
    buildCommand: "vp run build",
    dev: { command: "vp run dev" },
    domain: production
      ? { name: siteHostname, redirects: [`www.${siteHostname}`] }
      : undefined,
    environment: {
      NODE_ENV: "production",
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      SENTRY_ENVIRONMENT: getEnvironmentValue("SENTRY_ENVIRONMENT", stage),
      VITE_PUBLIC_POSTHOG_HOST: getEnvironmentValue(
        "VITE_PUBLIC_POSTHOG_HOST",
        "https://eu.i.posthog.com"
      ),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: getEnvironmentValue(
        "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN",
        ""
      ),
      VITE_SENTRY_DSN: getEnvironmentValue("VITE_SENTRY_DSN", ""),
    },
    link: [appDatabase],
    path: sitePath,
    transform: {
      server(args) {
        args.compatibility = {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        };
        args.transform = {
          worker(workerArgs) {
            workerArgs.observability = cloudflareWorkerObservability;
          },
        };
      },
    },
  });
