import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { wgslVitePlugin } from "vgpu/client";
import type { Plugin, Environment } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";
import { unstable_readConfig } from "wrangler";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

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

const buildId =
  process.env.QUIETER_BUILD_ID ??
  process.env.GITHUB_SHA ??
  Date.now().toString(36);
process.env.QUIETER_BUILD_ID = buildId;

const emitBuildId = (): Plugin => ({
  applyToEnvironment: (environment: Environment) =>
    environment.name === "client",
  generateBundle() {
    this.emitFile({
      fileName: "assets/build-id.txt",
      source: buildId,
      type: "asset",
    });
  },
  name: "emit-build-id",
});

export default defineConfig(({ command }) => {
  const configPath = process.env.SST_WRANGLER_PATH;
  const isDev = command === "serve";
  const isSentryEnabled = !isDev && !!process.env.SENTRY_AUTH_TOKEN;
  const sentryPluginsFor = (
    environmentName: "client" | "ssr",
    outputDirectory: "client" | "server"
  ) =>
    sentryTanstackStart({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      autoInstrumentMiddleware: false,
      buildTimeInstrumentation: false,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      release: { name: buildId },
      sourcemaps: {
        assets:
          outputDirectory === "client"
            ? ["./.cloudflare/output/v0/workers/default/assets/**/*.js"]
            : ["./.cloudflare/output/v0/workers/default/bundle/**/*.js"],
        filesToDeleteAfterUpload:
          outputDirectory === "client"
            ? ["./.cloudflare/output/v0/workers/default/assets/**/*.map"]
            : [],
      },
      telemetry: false,
    }).map((plugin) => ({
      ...plugin,
      applyToEnvironment: (environment: Environment) =>
        environment.name === environmentName,
    }));
  const sentryPlugins = isSentryEnabled
    ? [
        ...sentryPluginsFor("client", "client"),
        ...sentryPluginsFor("ssr", "server"),
      ]
    : [];

  return {
    build: {
      assetsDir: `_releases/${buildId}/assets`,
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        external: ["cloudflare:workers"],
      },
      sourcemap: isSentryEnabled,
    },
    define: {
      __QUIETER_BUILD_ID__: JSON.stringify(buildId),
    },
    envDir: workspaceRoot,
    optimizeDeps: {
      include: ["motion", "motion/react"],
    },
    plugins: lazyPlugins(() => [
      wgslVitePlugin(),
      cloudflare({
        config: configPath
          ? (worker) => {
              const config = unstable_readConfig({ config: configPath });
              const bindingNames = [
                ...Object.keys(config.vars),
                ...(config.hyperdrive ?? []).map((binding) => binding.binding),
                ...(config.durable_objects?.bindings ?? []).map(
                  (binding) => binding.name
                ),
                ...(config.r2_buckets ?? []).map((binding) => binding.binding),
                ...(config.services ?? []).map((binding) => binding.binding),
              ];
              if (
                worker.name !== config.name ||
                bindingNames.some((name) => !(name in (worker.env ?? {})))
              ) {
                throw new Error(
                  "The Cloudflare configuration did not load SST's generated bindings."
                );
              }
            }
          : undefined,
        persistState: { path: `${workspaceRoot}/.wrangler/state` },
        remoteBindings: false,
        viteEnvironment: { name: "ssr" },
      }),
      preferNodeAwsSdkResolution(),
      tanstackStart(),
      viteReact(),
      babel({
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      emitBuildId(),
      ...sentryPlugins,
    ]),
    publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
    resolve: {
      alias: {
        "#": fileURLToPath(new URL("./src", import.meta.url)),
      },
      dedupe: ["@tanstack/react-router", "motion", "react", "react-dom"],
    },
  };
});
