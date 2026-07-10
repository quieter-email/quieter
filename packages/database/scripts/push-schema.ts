import { serverEnv } from "@quieter/env/server";
import { assertLocalDatabaseUrl } from "./database-url";
import { exitOnKitError, kitPushOptions, push } from "./drizzle-kit";

const databaseUrl = serverEnv.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

assertLocalDatabaseUrl(databaseUrl);

const response = await push(kitPushOptions());
exitOnKitError(response);

if (response.status === "ok") {
  console.log(`Applied schema changes to the live ${response.dialect} database`);
} else if (response.status === "no_changes") {
  console.log("Database already in sync");
} else if (response.status === "missing_hints") {
  console.error(`
drizzle-kit push needs hint resolutions when the schema diff is ambiguous
(for example, a table that may have been renamed vs dropped and recreated).
--force only auto-approves data-loss statements; it does not skip rename prompts.

Try one of these:
  • Run db:push from an interactive terminal (Windows Terminal or PowerShell)
  • Apply committed migrations: vp run db:migrate
  • Generate a migration for schema changes: vp run db:generate
`);
  globalThis.process.exit(1);
}
