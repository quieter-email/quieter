import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];
const migrationRunCommand =
  "bun --env-file=../../.env.local scripts/run-migrations.ts";

export default defineConfig({
  run: {
    tasks: {
      "db:check": {
        cache: false,
        command:
          "bun scripts/check-migrations.ts && bun scripts/check-schema-drift.ts && bun scripts/migration-safety.ts",
        dependsOn: dependencyBuild,
      },
      "db:deploy": {
        cache: false,
        command: migrationRunCommand,
        dependsOn: dependencyBuild,
      },
      "db:generate": {
        cache: false,
        command: "bun scripts/generate-migration.ts",
        dependsOn: dependencyBuild,
      },
      "db:migrate": {
        cache: false,
        command: migrationRunCommand,
        dependsOn: dependencyBuild,
      },
      "db:push": {
        cache: false,
        command: "bun --env-file=../../.env.local scripts/push-schema.ts",
        dependsOn: dependencyBuild,
      },
      "db:test-migrations": {
        cache: false,
        command: "bun scripts/test-migrations.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
});
