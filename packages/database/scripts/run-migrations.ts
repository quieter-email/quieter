import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";
import { runKitMigrate } from "./drizzle-kit";
import { assertMigrationFilesAreDeploySafe } from "./migration-safety";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const databaseUrl = getMigrationDatabaseUrl();

assertMigrationFilesAreDeploySafe();
assertMigrationExecutionAllowed(databaseUrl);

globalThis.process.env.DATABASE_URL = databaseUrl;

await runKitMigrate(join(packageDirectory, "drizzle.config.ts"));
