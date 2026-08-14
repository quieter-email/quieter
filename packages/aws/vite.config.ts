import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];

export default defineConfig({
  run: {
    tasks: {
      "check:boundaries": {
        cache: false,
        command: "bun scripts/check-import-boundaries.ts",
        dependsOn: dependencyBuild,
      },
      "check:bundles": {
        cache: false,
        command: "bun scripts/check-handler-bundles.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
});
