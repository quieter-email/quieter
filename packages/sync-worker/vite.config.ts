import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    cloudflareTest({ wrangler: { configPath: "./wrangler.types.jsonc" } }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
