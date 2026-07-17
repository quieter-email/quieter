import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";
import { assertMigrationFilesAreDeploySafe } from "./migration-safety";
import { runForwardMigrations } from "./run-forward-migrations";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const databaseUrl = getMigrationDatabaseUrl();

assertMigrationFilesAreDeploySafe();
assertMigrationExecutionAllowed(databaseUrl);

globalThis.process.env.DATABASE_URL = databaseUrl;

await runForwardMigrations({
  databaseUrl,
  migrationsDirectory: join(packageDirectory, "drizzle"),
  packageDirectory,
});
