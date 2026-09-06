import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { assertLocalDevelopmentDatabaseUrls } from "@quieter/database/local-development";
import { createWebBuildEnv } from "@quieter/env/build";
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

/**
 * Identifies one build across the client bundle and the file the deployment
 * serves, so a stale tab can tell "the release moved on" apart from "this
 * chunk is genuinely broken". Read at module scope so every environment in a
 * build agrees on the value.
 */
const buildEnvironment = createWebBuildEnv();
const releaseBuild = buildEnvironment.QUIETER_RELEASE_BUILD === "true";
const buildId =
  buildEnvironment.QUIETER_BUILD_ID ??
  buildEnvironment.GITHUB_SHA ??
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
  const isDev = command === "serve";
  const isSentryEnabled =
    !isDev && !releaseBuild && !!buildEnvironment.SENTRY_AUTH_TOKEN;
  const sentryPlugins = isSentryEnabled
    ? sentryTanstackStart({
        authToken: buildEnvironment.SENTRY_AUTH_TOKEN,
        autoInstrumentMiddleware: false,
        org: buildEnvironment.SENTRY_ORG,
        project: buildEnvironment.SENTRY_PROJECT,
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
      rolldownOptions: {
        // Supplied by the Workers runtime itself, so no bundler can resolve it.
        external: ["cloudflare:workers"],
      },
      sourcemap: releaseBuild ? "hidden" : isSentryEnabled,
    },
    define: {
      __QUIETER_BUILD_ID__: JSON.stringify(buildId),
    },
    envDir: releaseBuild ? false : workspaceRoot,
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
          buildEnvironment.SST_WRANGLER_PATH ??
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
