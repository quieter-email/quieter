import { fileURLToPath } from "node:url";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";
import { assertMigrationFilesAreDeploySafe } from "./migration-safety";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const databaseUrl = getMigrationDatabaseUrl();

assertMigrationFilesAreDeploySafe();
assertMigrationExecutionAllowed(databaseUrl);

const migrationProcess = Bun.spawn(["bunx", "drizzle-kit", "migrate"], {
  cwd: packageDirectory,
  env: {
    ...globalThis.process.env,
    DATABASE_URL: databaseUrl,
  },
  stderr: "inherit",
  stdout: "inherit",
});

const exitCode = await migrationProcess.exited;
if (exitCode !== 0) {
  globalThis.process.exit(exitCode);
}
