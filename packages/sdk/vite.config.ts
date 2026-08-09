import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      skipNodeModulesBundle: true,
    },
    dts: true,
    entry: ["src/index.ts"],
    fixedExtension: false,
    format: "esm",
    platform: "browser",
  },
});
