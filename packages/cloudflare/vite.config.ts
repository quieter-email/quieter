import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          SST_RESOURCE_GmailLiveSyncTokenSecret: JSON.stringify({
            value: "live-sync-secret",
          }),
          SST_RESOURCE_GmailPubSubProcessToken: JSON.stringify({
            value: "processor-secret",
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
        command: "bun scripts/check-handler-bundles.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
