import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.types.jsonc" },
      miniflare: {
        hyperdrives: {
          AppDatabaseV2:
            "postgresql://test:test@127.0.0.1:5432/sync_binding_test",
        },
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
