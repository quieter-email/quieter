import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: [/^@quieter\//u, "@js-temporal/polyfill", "jsbi", "zod"],
    },
    dts: { tsconfig: "../../tsconfig.management-cli.json" },
    entry: ["src/index.ts", "src/bin.ts"],
    fixedExtension: false,
    format: "esm",
    platform: "node",
  },
});
