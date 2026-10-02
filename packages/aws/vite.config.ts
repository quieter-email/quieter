import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];

export default defineConfig({
  run: {
    tasks: {
      "check:bundles": {
        cache: false,
        command: "node scripts/check-handler-bundles.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
});
