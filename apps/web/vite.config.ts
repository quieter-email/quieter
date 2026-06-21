import { serverEnv } from "@quieter/env/server";
import reactScan from "@react-scan/vite-plugin-react-scan";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const isSentryEnabled = !isDev && !!serverEnv.SENTRY_AUTH_TOKEN;
  const sentryPlugins = isSentryEnabled
    ? sentryTanstackStart({
        authToken: serverEnv.SENTRY_AUTH_TOKEN,
        autoInstrumentMiddleware: false,
        org: serverEnv.SENTRY_ORG,
        project: serverEnv.SENTRY_PROJECT,
        sourcemaps: {
          assets: ["./.vercel/output/static/**/*.js"],
          filesToDeleteAfterUpload: ["./.vercel/output/static/**/*.map"],
        },
        telemetry: false,
      }).map((plugin) => ({
        ...plugin,
        applyToEnvironment: (environment) => environment.name === "client",
      }))
    : [];

  return {
    build: {
      chunkSizeWarningLimit: 1200,
      sourcemap: isSentryEnabled,
    },
    plugins: [
      tanstackStart(),
      viteReact(),
      ...(isDev ? [reactScan()] : []),
      babel({
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      nitro({
        preset: "vercel",
        traceDeps: ["@paykit-sdk/polar", "@polar-sh/sdk", "react", "zod"],
      }),
      ...sentryPlugins,
    ],
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
