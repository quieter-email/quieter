import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];
const localEnvFile = "--env-file-if-exists=../../.env.local";

export default defineConfig({
  run: {
    tasks: {
      "catalog:sync": {
        cache: false,
        command: `node ${localEnvFile} scripts/sync-polar-catalog.ts`,
        dependsOn: dependencyBuild,
      },
      "credit-usage:sync": {
        cache: false,
        command: `node ${localEnvFile} scripts/sync-polar-credit-usage.ts`,
        dependsOn: dependencyBuild,
      },
    },
  },
});
