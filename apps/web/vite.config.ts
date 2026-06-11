import reactScan from "@react-scan/vite-plugin-react-scan";
import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const motionPackages = ["motion", "framer-motion", "motion-dom", "motion-utils"] as const;

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const isSentryEnabled = !isDev && !!process.env.SENTRY_AUTH_TOKEN;

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
      nitro({ preset: "vercel", traceDeps: ["react"] }),
      ...(isSentryEnabled
        ? [
            {
              name: "sentry-client-build",
              applyToEnvironment(environment) {
                return environment.name === "client"
                  ? sentryTanstackStart({
                      authToken: process.env.SENTRY_AUTH_TOKEN,
                      autoInstrumentMiddleware: false,
                      org: process.env.SENTRY_ORG,
                      project: process.env.SENTRY_PROJECT,
                      sourcemaps: {
                        assets: ["./.vercel/output/static/**/*.js"],
                        filesToDeleteAfterUpload: ["./.vercel/output/static/**/*.map"],
                      },
                      telemetry: false,
                    })
                  : false;
              },
            },
          ]
        : []),
    ],
    optimizeDeps: {
      include: [...motionPackages, "motion/react"],
    },
    resolve: {
      dedupe: ["@tanstack/react-router", "react", "react-dom", ...motionPackages],
      tsconfigPaths: true,
    },
    server: {
      port: 3000,
    },
  };
});
