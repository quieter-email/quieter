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

const validateLocalDevelopment = (): Plugin => ({
  config() {
    assertLocalDevelopmentDatabaseUrls();
  },
  name: "validate-local-development",
});

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
        applyToEnvironment: (environment: Environment) =>
          environment.name === "client",
      }))
    : [];

  return {
    build: {
      chunkSizeWarningLimit: 1200,
      sourcemap: isSentryEnabled,
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
        persistState: { path: `${workspaceRoot}/.wrangler/state` },
        remoteBindings: false,
        configPath:
          process.env.SST_WRANGLER_PATH ??
          (isDev
            ? fileURLToPath(
                new URL("../../local-worker.jsonc", import.meta.url)
              )
            : undefined),
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
