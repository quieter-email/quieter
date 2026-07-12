import { cloudflare } from "@cloudflare/vite-plugin";
import reactScan from "@react-scan/vite-plugin-react-scan";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, Environment, lazyPlugins } from "vite-plus";

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
        configPath: process.env.SST_WRANGLER_PATH,
      }),
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
