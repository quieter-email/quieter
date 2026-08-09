import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { assertLocalDevelopmentDatabaseUrls } from "@quieter/database/local-development";
import reactScan from "@react-scan/vite-plugin-react-scan";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin, Environment } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";

const localWorkerSecretNames = [
  "APP_SITE_PASSWORD",
  "AWS_DEFAULT_REGION",
  "AWS_EC2_METADATA_DISABLED",
  "AWS_REGION",
  "BETTER_AUTH_APP_NAME",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CONNECTOR_TOKEN_ENCRYPTION_KEY",
  "DATABASE_URL",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
  "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT",
  "GOOGLE_AUTH_CLIENT_ID",
  "GOOGLE_AUTH_CLIENT_SECRET",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_GMAIL_CLIENT_ID",
  "GOOGLE_GMAIL_CLIENT_SECRET",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "NODE_ENV",
  "OPENROUTER_API_KEY",
  "POLAR_ACCESS_TOKEN",
  "POLAR_ORGANIZATION_ID",
  "POLAR_PRODUCT_MANAGED_ID",
  "POLAR_PRODUCT_PRO_ID",
  "POLAR_SANDBOX",
  "POLAR_WEBHOOK_SECRET",
  "QUIETER_AUTH_MAIL_MODE",
  "QUIETER_AUTH_MAIL_SENDER",
  "QUIETER_DEPLOYMENT_ENV",
  "QUIETER_GMAIL_AI_AUTOMATION_ENABLED",
  "QUIETER_LOCAL_BILLING_BYPASS",
] as const;

/**
 * Cloudflare's Worker env defaults include the "browser" resolve condition. Vite merges
 * condition arrays, so user overrides cannot remove it. AWS SDK v3 then resolves
 * `@aws-sdk/core/client` browser stubs (Symbol.for("node-only")) while Node runtimeConfig
 * still calls emitWarningIfUnsupportedVersion, breaking SESv2Client in createSetup.
 * @see https://github.com/cloudflare/workers-sdk/issues/13952
 */
const preferNodeAwsSdkResolution = (): Plugin => {
  const withoutBrowser = (conditions: string[] | undefined) => {
    if (!conditions) {
      return;
    }
    const next = conditions.filter((condition) => condition !== "browser");
    if (!next.includes("node")) {
      next.push("node");
    }
    conditions.splice(0, conditions.length, ...next);
  };

  return {
    configResolved(config) {
      for (const [name, environment] of Object.entries(config.environments)) {
        if (name === "client") {
          continue;
        }
        withoutBrowser(environment.resolve.conditions);
        environment.optimizeDeps.esbuildOptions ??= {};
        environment.optimizeDeps.esbuildOptions.platform = "node";
        withoutBrowser(environment.optimizeDeps.esbuildOptions.conditions);
        const rolldownResolve = (
          environment.optimizeDeps as {
            rolldownOptions?: { resolve?: { conditionNames?: string[] } };
          }
        ).rolldownOptions?.resolve;
        withoutBrowser(rolldownResolve?.conditionNames);
      }
    },
    name: "prefer-node-aws-sdk-resolution",
  };
};

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  if (isDev) {
    assertLocalDevelopmentDatabaseUrls();
  }

  const isSentryEnabled = !isDev && !!process.env.SENTRY_AUTH_TOKEN;
  const sentryPlugins = isSentryEnabled
    ? sentryTanstackStart({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        autoInstrumentMiddleware: false,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        sourcemaps: {
          assets: ["./dist/client/**/*.js"],
          filesToDeleteAfterUpload: ["./dist/client/**/*.map"],
        },
        telemetry: false,
      }).map((plugin) => ({
        ...plugin,
        applyToEnvironment: (environment: Environment) =>
          environment.name === "client",
      }))
    : [];

  return {
    build: {
      chunkSizeWarningLimit: 1200,
      sourcemap: isSentryEnabled,
    },
    optimizeDeps: {
      include: [
        "@tiptap/core",
        "@tiptap/react",
        "@tiptap/starter-kit",
        "motion",
        "motion/react",
      ],
    },
    plugins: lazyPlugins(() => [
      cloudflare({
        config: isDev
          ? {
              secrets: {
                required: localWorkerSecretNames.filter(
                  (name) => process.env[name]
                ),
              },
            }
          : undefined,
        configPath:
          process.env.SST_WRANGLER_PATH ??
          (isDev ? "local-worker.jsonc" : undefined),
        viteEnvironment: { name: "ssr" },
      }),
      preferNodeAwsSdkResolution(),
      tanstackStart(),
      viteReact(),
      ...(isDev ? [reactScan()] : []),
      babel({
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      ...sentryPlugins,
    ]),
    resolve: {
      alias: {
        "#": fileURLToPath(new URL("./src", import.meta.url)),
      },
      dedupe: [
        "@tanstack/react-router",
        "@tiptap/core",
        "@tiptap/pm",
        "@tiptap/react",
        "motion",
        "prosemirror-model",
        "prosemirror-state",
        "prosemirror-transform",
        "prosemirror-view",
        "react",
        "react-dom",
      ],
    },
    server: {
      port: 3000,
    },
  };
});
