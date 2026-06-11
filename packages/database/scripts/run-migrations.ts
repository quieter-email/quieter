import { fileURLToPath } from "node:url";
import { getMigrationDatabaseUrl } from "./database-url";

const migrationProcess = Bun.spawn(["bunx", "drizzle-kit", "migrate"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
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
