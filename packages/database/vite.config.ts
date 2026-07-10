import { defineConfig } from "vite-plus";

const dependencyBuild = [{ task: "build", from: "dependencies" as const }];

export default defineConfig({
  run: {
    tasks: {
      "db:check": {
        command:
          "bun scripts/check-migrations.ts && bun scripts/check-schema-drift.ts && bun scripts/migration-safety.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
      "db:deploy": {
        command: "bun --env-file=../../.env.local scripts/run-migrations.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
      "db:generate": {
        command: "bun scripts/generate-migration.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
      "db:migrate": {
        command: "bun --env-file=../../.env.local scripts/run-migrations.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
      "db:push": {
        command: "bun --env-file=../../.env.local scripts/push-schema.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
      "db:test-migrations": {
        command: "bun scripts/test-migrations.ts",
        dependsOn: dependencyBuild,
        cache: false,
      },
    },
  },
});
