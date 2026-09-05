import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          CONNECTOR_TOKEN_ENCRYPTION_KEY: "connector-token-key",
          GMAIL_TOKEN_ENCRYPTION_KEY: "gmail-token-key",
          GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: "gmail-token-key-current",
          GOOGLE_CALENDAR_CLIENT_ID: "calendar-client-id",
          GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-client-secret",
          GOOGLE_GMAIL_CLIENT_ID: "gmail-client-id",
          GOOGLE_GMAIL_CLIENT_SECRET: "gmail-client-secret",
          LINEAR_CLIENT_ID: "linear-client-id",
          LINEAR_CLIENT_SECRET: "linear-client-secret",
          OPENROUTER_API_KEY: "openrouter-key",
          POLAR_ACCESS_TOKEN: "polar-access-token",
          SST_RESOURCE_GmailLiveSyncTokenSecret: JSON.stringify({
            value: "live-sync-secret",
          }),
        },
      },
      wrangler: { configPath: "./wrangler.types.jsonc" },
    }),
  ],
  run: {
    tasks: {
      "check:bundles": {
        cache: false,
        command: "node scripts/check-handler-bundles.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
