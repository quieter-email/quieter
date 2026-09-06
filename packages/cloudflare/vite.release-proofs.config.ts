import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.release-proofs.jsonc" },
    }),
  ],
  test: { include: ["release-proof-tests/**/*.test.ts"] },
});
