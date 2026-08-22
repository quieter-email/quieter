import { serverEnv } from "@quieter/env/server";

import { assertLocalDatabaseUrl } from "./database-url.ts";
import { exitOnKitError, kitPushOptions, push } from "./drizzle-kit.ts";

const databaseUrl = serverEnv.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error("DATABASE_URL is required");
}

assertLocalDatabaseUrl(databaseUrl);

const response = await push(kitPushOptions());
exitOnKitError(response);

if (response.status === "ok") {
  process.stdout.write(
    `Applied schema changes to the live ${response.dialect} database\n`
  );
} else if (response.status === "no_changes") {
  process.stdout.write("Database already in sync\n");
} else if (response.status === "missing_hints") {
  process.stderr.write(`
drizzle-kit push needs hint resolutions when the schema diff is ambiguous
(for example, a table that may have been renamed vs dropped and recreated).
--force only auto-approves data-loss statements; it does not skip rename prompts.

Try one of these:
  • Run db:push from an interactive terminal (Windows Terminal or PowerShell)
  • Apply committed migrations: vp run db:migrate
  • Generate a migration for schema changes: vp run db:generate
`);
  throw new Error("Schema push requires hint resolutions.");
}
