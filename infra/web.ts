/* oxlint-disable eslint/max-classes-per-file -- The deployment subclass captures release bindings during SST's build-plan hook. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";
import { webReleasePlanSchema } from "@quieter/env/deployment";
import { appHostname } from "@quieter/env/hosts";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import {
  appOrigin,
  deploymentEnvironment,
  getEnvironmentValue,
  production,
  stage,
} from "./stage";
import { createQuieterTanStackStart } from "./tanstack-start";
import type { SstLinkable } from "./types";
import { deriveWebReleaseScope, WEB_RELEASE_SLOTS } from "./web-release-scope";

const webSitePath = "apps/web";
const WebTanStackStart = createQuieterTanStackStart(webSitePath);

const webDomain = production ? { name: appHostname } : undefined;

export const createWeb = (
  appDatabase: ReturnType<typeof createAppDatabase>,
  webSecretBindings: SstLinkable[],
  runtimeEnvironment: Record<string, $util.Input<string>> = {},
  links: SstLinkable[] = []
) => {
  const deployment =
    production && !$dev
      ? webReleasePlanSchema.parse(
          JSON.parse(readFileSync(".sst/web-deployment.json", "utf-8"))
        )
      : null;
  if (
    deployment !== null &&
    deployment.manifest.current.buildId !==
      getEnvironmentValue("QUIETER_BUILD_ID", "")
  ) {
    throw new Error("The prepared web routing belongs to another build.");
  }
  const environment = {
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
    QUIETER_MAIL_API_URL: `${appOrigin}/api/send`,
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
  };
  const releaseLinks = [...webSecretBindings, appDatabase, ...links];
  let promotionManifest: $util.Input<string> | undefined;
  class RetainedWebTanStackStart extends WebTanStackStart {
    protected override buildPlan(outputPath: $util.Output<string>) {
      const plan = super.buildPlan(outputPath);
      if (deployment !== null) {
        const scope = deriveWebReleaseScope(deployment);
        const promotionEtags: $util.Output<string>[] = [];
        for (const { componentName, serviceName, slot } of WEB_RELEASE_SLOTS) {
          const release = new sst.cloudflare.Worker(componentName, {
            assets: {
              directory: $util
                .all([outputPath, plan])
                .apply(([directory, paths]) =>
                  path.join(directory, paths.assets)
                ),
            },
            compatibility: {
              date: COMPATIBILITY_DATE,
              flags: ["nodejs_compat"],
            },
            dev: false,
            environment,
            handler: $util
              .all([outputPath, plan])
              .apply(([directory, paths]) =>
                path.join(directory, paths.server)
              ),
            link: releaseLinks,
            transform: {
              worker(args) {
                args.observability = cloudflareWorkerObservability;
                args.scriptName = serviceName;
              },
            },
            url: false,
          });
          if (
            scope.promotionSlots.some((promotion) => promotion.slot === slot)
          ) {
            promotionEtags.push(release.nodes.worker.etag);
          }
        }
        promotionManifest =
          promotionEtags.length === 0
            ? JSON.stringify(deployment.manifest)
            : $util
                .all(promotionEtags)
                .apply(() => JSON.stringify(deployment.manifest));
      }
      return plan;
    }
  }
  return new RetainedWebTanStackStart("Web", {
    buildCommand: production
      ? `vp exec node ../../scripts/prepared-web-build.ts ${$cli.command}`
      : "vp run build",
    dev: { command: "vp run dev" },
    domain: webDomain,
    environment,
    link: releaseLinks,
    path: webSitePath,
    transform: {
      server(args) {
        args.compatibility = {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        };
        args.transform = {
          worker(workerArgs) {
            workerArgs.observability = cloudflareWorkerObservability;
            if (deployment !== null) {
              workerArgs.bindings = $util
                .output(workerArgs.bindings ?? [])
                .apply((bindings) => [
                  ...bindings.filter(
                    (binding) =>
                      binding.type === "service" ||
                      binding.name === "QUIETER_WEB_DEPLOYMENT" ||
                      binding.name === "SST_RESOURCE_App"
                  ),
                  ...WEB_RELEASE_SLOTS.map(
                    ({ componentName, serviceName }) => ({
                      name: componentName,
                      service: serviceName,
                      type: "service" as const,
                    })
                  ),
                ]);
            }
          },
        };
        if (deployment !== null) {
          args.assets = undefined;
          args.handler = "packages/cloudflare/src/web-router.ts";
          // Keep legacy IAM resources until the old app has stopped serving traffic.
          args.link =
            deployment.manifest.previous === null &&
            deployment.updateSlot !== null
              ? links
              : [];
          args.environment = {
            // SST resolves compatibility before buildPlan creates the releases.
            QUIETER_WEB_DEPLOYMENT:
              promotionManifest ?? JSON.stringify(deployment.manifest),
          };
        }
      },
    },
  });
};
