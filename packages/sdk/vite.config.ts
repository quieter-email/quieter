import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: [/^@quieter\/mail(?:\/|$)/u],
      onlyImport: ["zod", "react", "@react-email/render"],
    },
    dts: { tsconfig: "../../tsconfig.sdk.json" },
    entry: ["src/index.ts", "src/react.ts"],
    fixedExtension: false,
    format: "esm",
    platform: "browser",
  },
});
