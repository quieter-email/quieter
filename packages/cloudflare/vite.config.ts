import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          SST_RESOURCE_GmailLiveSyncTokenSecret: JSON.stringify({ value: "live-sync-secret" }),
          SST_RESOURCE_GmailPubSubProcessToken: JSON.stringify({ value: "processor-secret" }),
        },
      },
      wrangler: { configPath: "./wrangler.types.jsonc" },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
