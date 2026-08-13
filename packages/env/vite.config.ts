import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      neverBundle: true,
    },
    dts: false,
    entry: [
      "src/client.ts",
      "src/local-doctor.ts",
      "src/public.ts",
      "src/server.ts",
      "src/sst.ts",
      "src/sst-secrets.ts",
    ],
    fixedExtension: false,
    format: "esm",
    platform: "node",
  },
});
