import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";
import { assertMigrationFilesAreDeploySafe } from "./migration-safety.ts";
import { runForwardMigrations } from "./run-forward-migrations.ts";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const databaseUrl = getMigrationDatabaseUrl();

assertMigrationFilesAreDeploySafe();
assertMigrationExecutionAllowed(databaseUrl);

globalThis.process.env.DATABASE_URL = databaseUrl;

await runForwardMigrations({
  databaseUrl,
  migrationsDirectory: path.join(packageDirectory, "drizzle"),
  packageDirectory,
});
