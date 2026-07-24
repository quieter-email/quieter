import type { Plugin } from "vite-plus";
import { cloudflare } from "@cloudflare/vite-plugin";
import reactScan from "@react-scan/vite-plugin-react-scan";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, Environment, lazyPlugins } from "vite-plus";

/**
 * Cloudflare's Worker env defaults include the "browser" resolve condition. Vite merges
 * condition arrays, so user overrides cannot remove it. AWS SDK v3 then resolves
 * `@aws-sdk/core/client` browser stubs (Symbol.for("node-only")) while Node runtimeConfig
 * still calls emitWarningIfUnsupportedVersion, breaking SESv2Client in createSetup.
 * @see https://github.com/cloudflare/workers-sdk/issues/13952
 */
const preferNodeAwsSdkResolution = (): Plugin => {
  const withoutBrowser = (conditions: string[] | undefined) => {
    if (!conditions) return;
    const next = conditions.filter((condition) => condition !== "browser");
    if (!next.includes("node")) next.push("node");
    conditions.splice(0, conditions.length, ...next);
  };

  return {
    name: "prefer-node-aws-sdk-resolution",
    configResolved(config) {
      for (const [name, environment] of Object.entries(config.environments)) {
        if (name === "client") continue;
        withoutBrowser(environment.resolve.conditions);
        withoutBrowser(environment.optimizeDeps.esbuildOptions?.conditions);
        const rolldownResolve = (
          environment.optimizeDeps as {
            rolldownOptions?: { resolve?: { conditionNames?: string[] } };
          }
        ).rolldownOptions?.resolve;
        withoutBrowser(rolldownResolve?.conditionNames);
      }
    },
  };
};

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
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
        applyToEnvironment: (environment: Environment) => environment.name === "client",
      }))
    : [];

  return {
    build: {
      chunkSizeWarningLimit: 1200,
      sourcemap: isSentryEnabled,
    },
    plugins: lazyPlugins(() => [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        configPath: process.env.SST_WRANGLER_PATH ?? (isDev ? "local-worker.jsonc" : undefined),
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
    optimizeDeps: {
      include: ["motion", "motion/react"],
    },
    resolve: {
      dedupe: ["@tanstack/react-router", "react", "react-dom", "motion"],
      tsconfigPaths: true,
    },
    server: {
      port: 3000,
    },
  };
});
