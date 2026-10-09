import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { assertLocalDevelopmentDatabaseUrls } from "@quieter/database/local-development";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin, Environment } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";
import { unstable_readConfig } from "wrangler";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

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

/**
 * Identifies one build across the client bundle and the file the deployment
 * serves, so a stale tab can tell "the release moved on" apart from "this
 * chunk is genuinely broken". Read at module scope so every environment in a
 * build agrees on the value.
 */
const buildId =
  process.env.QUIETER_BUILD_ID ??
  process.env.GITHUB_SHA ??
  Date.now().toString(36);

/** Served from `/assets/` because that prefix bypasses the site password gate. */
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

const validateLocalDevelopment = (): Plugin => ({
  config() {
    assertLocalDevelopmentDatabaseUrls();
  },
  name: "validate-local-development",
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
      // Worker instrumentation is configured by the Cloudflare runtime wrapper.
      buildTimeInstrumentation: false,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      release: { name: buildId },
      sourcemaps: {
        assets:
          outputDirectory === "client"
            ? ["./.cloudflare/output/v0/workers/default/assets/**/*.js"]
            : ["./.cloudflare/output/v0/workers/default/bundle/**/*.js"],
        // SST still needs server maps when packaging the Worker.
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
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        // Supplied by the Workers runtime itself, so no bundler can resolve it.
        external: ["cloudflare:workers"],
      },
      sourcemap: isSentryEnabled,
    },
    define: {
      __QUIETER_BUILD_ID__: JSON.stringify(buildId),
    },
    envDir: workspaceRoot,
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
        // SST checks this file for its generated config; cf loads the adapter separately.
        config: configPath
          ? (worker) => {
              const config = unstable_readConfig({ config: configPath });
              const bindingNames = [
                ...Object.keys(config.vars),
                ...config.hyperdrive.map((binding) => binding.binding),
                ...config.durable_objects.bindings.map(
                  (binding) => binding.name
                ),
                ...config.r2_buckets.map((binding) => binding.binding),
                ...config.services.map((binding) => binding.binding),
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
      ...(isDev ? [validateLocalDevelopment()] : []),
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
  };
});
