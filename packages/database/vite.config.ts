import { defineConfig } from "vite-plus";

const dependencyBuild = [{ from: "dependencies" as const, task: "build" }];
const migrationRunCommand =
  "node --env-file-if-exists=../../.env.local scripts/run-migrations.ts";

export default defineConfig({
  run: {
    tasks: {
      "db:check": {
        cache: false,
        command:
          "node scripts/check-migrations.ts && node scripts/check-schema-drift.ts && node scripts/migration-safety.ts",
        dependsOn: dependencyBuild,
      },
      "db:deploy": {
        cache: false,
        command: migrationRunCommand,
        dependsOn: dependencyBuild,
      },
      "db:generate": {
        cache: false,
        command: "node scripts/generate-migration.ts",
        dependsOn: dependencyBuild,
      },
      "db:migrate": {
        cache: false,
        command: migrationRunCommand,
        dependsOn: dependencyBuild,
      },
      "db:push": {
        cache: false,
        command:
          "node --env-file-if-exists=../../.env.local scripts/push-schema.ts",
        dependsOn: dependencyBuild,
      },
      "db:test-migrations": {
        cache: false,
        command: "node scripts/test-migrations.ts",
        dependsOn: dependencyBuild,
      },
    },
  },
});
