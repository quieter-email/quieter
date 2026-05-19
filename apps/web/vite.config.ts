import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN,
  },
  plugins: [
    tanstackStart(),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    nitro({ preset: "vercel", traceDeps: ["react"] }),
    sentryTanstackStart({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      sourcemaps: {
        filesToDeleteAfterUpload: ["./.vercel/output/**/*.map", "./node_modules/.nitro/**/*.map"],
      },
      telemetry: false,
    }),
  ],
  resolve: {
    dedupe: ["@tanstack/react-router", "react", "react-dom"],
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
  },
});
