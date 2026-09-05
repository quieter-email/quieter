import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];

export default defineConfig({
  run: {
    tasks: {
      "check:boundaries": {
        cache: false,
        command: "node scripts/check-import-boundaries.ts",
        dependsOn: dependencyBuild,
      },
      "check:bundles": {
        cache: false,
        command: "node scripts/check-handler-bundles.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
});
