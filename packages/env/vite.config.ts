import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/client.ts", "src/deployment.ts", "src/public.ts", "src/server.ts", "src/sst.ts"],
    deps: {
      skipNodeModulesBundle: true,
    },
    dts: false,
    fixedExtension: false,
    format: "esm",
    platform: "node",
  },
});
