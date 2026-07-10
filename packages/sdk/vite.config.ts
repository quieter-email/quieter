import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    deps: {
      skipNodeModulesBundle: true,
    },
    dts: true,
    fixedExtension: false,
    format: "esm",
    platform: "browser",
  },
});
