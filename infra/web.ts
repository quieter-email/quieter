import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import {
  appOrigin,
  deploymentEnvironment,
  getEnvironmentValue,
  production,
  stage,
} from "./stage";
import type { SstLinkable } from "./types";

const webDomain: string | { name: string; redirects: string[] } | undefined =
  production
    ? { name: "quieter.email", redirects: ["www.quieter.email"] }
    : undefined;

export const createWeb = (
  appDatabase: ReturnType<typeof createAppDatabase>,
  webSecretBindings: SstLinkable[],
  runtimeEnvironment: Record<string, $util.Input<string>> = {},
  links: SstLinkable[] = []
) =>
  new sst.cloudflare.TanStackStart("Web", {
    dev: { command: "vp run dev" },
    domain: webDomain,
    environment: {
      AWS_DEFAULT_REGION: getEnvironmentValue("AWS_REGION", "eu-central-1"),
      AWS_REGION: getEnvironmentValue("AWS_REGION", "eu-central-1"),
      BETTER_AUTH_APP_NAME: getEnvironmentValue(
        "BETTER_AUTH_APP_NAME",
        "quieter"
      ),
      BETTER_AUTH_TRUSTED_ORIGINS: getEnvironmentValue(
        "BETTER_AUTH_TRUSTED_ORIGINS",
        ""
      ),
      BETTER_AUTH_URL: appOrigin,
      NODE_ENV: "production",
      QUIETER_AUTH_MAIL_MODE: getEnvironmentValue(
        "QUIETER_AUTH_MAIL_MODE",
        "api"
      ),
      QUIETER_AUTH_MAIL_SENDER: getEnvironmentValue(
        "QUIETER_AUTH_MAIL_SENDER",
        "auth@quieter.email"
      ),
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: String(production),
      QUIETER_MAIL_API_URL: `${appOrigin}/api/v1/send`,
      QUIETER_PREVIEW_PERSONAS_ENABLED: getEnvironmentValue(
        "QUIETER_PREVIEW_PERSONAS_ENABLED",
        "false"
      ),
      SENTRY_ENVIRONMENT: getEnvironmentValue("SENTRY_ENVIRONMENT", stage),
      VITE_LOGO_DEV_PUBLISHABLE_KEY: getEnvironmentValue(
        "VITE_LOGO_DEV_PUBLISHABLE_KEY",
        ""
      ),
      VITE_PUBLIC_POSTHOG_HOST: getEnvironmentValue(
        "VITE_PUBLIC_POSTHOG_HOST",
        "https://eu.i.posthog.com"
      ),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: getEnvironmentValue(
        "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN",
        ""
      ),
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: getEnvironmentValue(
        "VITE_QUIETER_PREVIEW_PERSONAS_ENABLED",
        "false"
      ),
      VITE_SENTRY_DSN: getEnvironmentValue("VITE_SENTRY_DSN", ""),
      ...runtimeEnvironment,
    },
    link: [...webSecretBindings, appDatabase, ...links],
    path: "apps/web",
    transform: {
      server: {
        compatibility: {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        },
        transform: {
          worker(args) {
            args.observability = cloudflareWorkerObservability;
          },
        },
      },
    },
  });
