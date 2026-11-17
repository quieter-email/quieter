import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: [/^@quieter\//u, "@js-temporal/polyfill", "jsbi"],
      onlyImport: ["zod"],
    },
    dts: { tsconfig: "../../tsconfig.management-sdk.json" },
    entry: ["src/index.ts"],
    fixedExtension: false,
    format: "esm",
    platform: "browser",
  },
});
