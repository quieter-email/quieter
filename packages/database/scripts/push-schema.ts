import { serverEnv } from "@quieter/env/server";
import { fileURLToPath } from "node:url";
import { assertLocalDatabaseUrl } from "./database-url";

const databaseUrl = serverEnv.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

assertLocalDatabaseUrl(databaseUrl);

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const pushArgs = process.argv.slice(2);

const pushProcess = Bun.spawn(["bunx", "drizzle-kit", "push", ...pushArgs], {
  cwd: packageDirectory,
  env: globalThis.process.env,
  stdin: "inherit",
  stderr: "inherit",
  stdout: "inherit",
});

const exitCode = await pushProcess.exited;
if (exitCode !== 0 && !(process.stdin.isTTY && process.stdout.isTTY)) {
  console.error(`
drizzle-kit push needs an interactive terminal when the schema diff is ambiguous
(for example, a table that may have been renamed vs dropped and recreated).
--force only auto-approves data-loss statements; it does not skip rename prompts.

Try one of these:
  • Run db:push from an interactive terminal (Windows Terminal or PowerShell)
  • Apply committed migrations: bun run db:migrate
  • Generate a migration for schema changes: bun run db:generate
`);
}

globalThis.process.exit(exitCode);
