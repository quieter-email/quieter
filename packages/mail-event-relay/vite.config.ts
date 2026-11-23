import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: [/.*/u],
      onlyBundle: ["postgres", "zod", "@t3-oss/env-core"],
    },
    dts: false,
    entry: ["src/index.ts"],
    format: "esm",
    platform: "node",
  },
  resolve: {
    conditions: ["development"],
  },
});
