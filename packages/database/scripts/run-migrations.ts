import { fileURLToPath } from "node:url";
import { getMigrationDatabaseUrl } from "./database-url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

const prepareProcess = Bun.spawn(["bun", "scripts/prepare-production.ts"], {
  cwd: packageDirectory,
  env: globalThis.process.env,
  stderr: "inherit",
  stdout: "inherit",
});

const prepareExitCode = await prepareProcess.exited;
if (prepareExitCode !== 0) {
  globalThis.process.exit(prepareExitCode);
}

const migrationProcess = Bun.spawn(["bunx", "drizzle-kit", "migrate"], {
  cwd: packageDirectory,
  env: {
    ...globalThis.process.env,
    DATABASE_URL: getMigrationDatabaseUrl(),
  },
  stderr: "inherit",
  stdout: "inherit",
});

const exitCode = await migrationProcess.exited;
if (exitCode !== 0) {
  globalThis.process.exit(exitCode);
}
