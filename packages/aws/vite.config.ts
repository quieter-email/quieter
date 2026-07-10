import { defineConfig } from "vite-plus";

const dependencyBuild = [{ task: "build", from: "dependencies" as const }];

export default defineConfig({
  run: {
    tasks: {
      "check:boundaries": {
        command: "bun scripts/check-import-boundaries.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
      "check:bundles": {
        command: "bun scripts/check-handler-bundles.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
    },
  },
});
