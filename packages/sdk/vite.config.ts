import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
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
    {
      clean: false,
      deps: {
        alwaysBundle: [
          /^@quieter\/(?:mail|env)(?:\/|$)/u,
          /^@t3-oss\/env-core(?:\/|$)/u,
        ],
        onlyImport: ["zod", "jiti", "chokidar", "react", "@react-email/render"],
      },
      dts: false,
      entry: ["src/cli.ts"],
      fixedExtension: false,
      format: "esm",
      outDir: "dist/cli",
      platform: "node",
      target: "node22",
    },
  ],
});
