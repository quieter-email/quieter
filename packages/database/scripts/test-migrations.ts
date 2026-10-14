import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { assertLocalDatabaseUrl } from "./database-url.ts";
import { runKitMigrate } from "./drizzle-kit.ts";
import {
  migrationLedger,
  runForwardMigrations,
} from "./run-forward-migrations.ts";
import { testBillingCreditRepair } from "./test-billing-credit-repair.ts";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = path.join(packageDirectory, "drizzle");
const migrationNames = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

if (migrationNames.length < 2) {
  throw new Error(
    "Migration integration tests require a baseline and a forward migration"
  );
}

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL?.trim();
if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error(
    "MIGRATION_TEST_DATABASE_URL is required for destructive migration tests"
  );
}

assertLocalDatabaseUrl(databaseUrl, "quieter_migration_test");
process.env.DATABASE_URL = databaseUrl;
const sql = postgres(databaseUrl, { max: 1 });
const temporaryDirectory = mkdtempSync(
  path.join(packageDirectory, ".migration-test-")
);

const resetDatabase = async () => {
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
};

const assertMigrationHistory = async () => {
  const history = await drizzle({ client: sql })
    .select({ name: migrationLedger.name })
    .from(migrationLedger)
    .orderBy(asc(migrationLedger.id));
  const appliedNames = history.map((entry) => entry.name);

  if (
    appliedNames.length !== migrationNames.length ||
    appliedNames.some((name, index) => name !== migrationNames[index])
  ) {
    throw new Error(
      `Expected migration history ${migrationNames.join(", ")}, received ${appliedNames.join(", ")}`
    );
  }
};

try {
  await resetDatabase();
  await runForwardMigrations({
    databaseUrl,
    migrationsDirectory,
    packageDirectory,
  });
  await assertMigrationHistory();

  await runForwardMigrations({
    databaseUrl,
    migrationsDirectory,
    packageDirectory,
  });
  await assertMigrationHistory();

  await resetDatabase();

  const baselineDirectory = path.join(temporaryDirectory, "drizzle");
  const [baselineName] = migrationNames;
  if (baselineName === undefined || baselineName === "") {
    throw new Error("Migration integration tests require a baseline migration");
  }
  cpSync(
    path.join(migrationsDirectory, baselineName),
    path.join(baselineDirectory, baselineName),
    {
      recursive: true,
    }
  );

  const temporaryConfigPath = path.join(
    temporaryDirectory,
    "drizzle.config.ts"
  );
  writeFileSync(
    temporaryConfigPath,
    `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: ${JSON.stringify(baselineDirectory)},
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`
  );

  runKitMigrate(temporaryConfigPath);
  await runForwardMigrations({
    databaseUrl,
    migrationsDirectory,
    packageDirectory,
  });
  await assertMigrationHistory();
  await testBillingCreditRepair(sql);
} finally {
  await sql.end();
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
