import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = path.join(packageDirectory, "drizzle");
const destructiveStatements = [
  /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/iu,
  /\bTRUNCATE\b/iu,
  /\bDELETE\s+FROM\b/iu,
  /\bDROP\s+COLUMN\b/iu,
  /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/iu,
];

export const assertMigrationSqlIsDeploySafe = (
  sql: string,
  migrationName: string
) => {
  // Contract migrations are reviewed and applied manually (e.g. DROP TABLE
  // for never-written tables). Mark them with `-- quieter:contract` and they
  // bypass the expand-safe check.
  if (sql.includes("-- quieter:contract")) {
    return;
  }

  if (destructiveStatements.some((pattern) => pattern.test(sql))) {
    throw new Error(
      `Migration ${migrationName} contains destructive SQL. Production deploys only allow expand-safe migrations; run contract migrations through a separately reviewed manual procedure.`
    );
  }

  const isNonTransactional = sql.includes("-- quieter:no-transaction");
  const createsConcurrentIndex =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/iu.test(sql);
  if (isNonTransactional && !createsConcurrentIndex) {
    throw new Error(
      `Migration ${migrationName} opts out of transactions without creating a concurrent index. Reserve non-transactional migrations for reviewed PostgreSQL operations that cannot run in a transaction.`
    );
  }
  if (createsConcurrentIndex && !isNonTransactional) {
    throw new Error(
      `Migration ${migrationName} creates a concurrent index without the -- quieter:no-transaction marker.`
    );
  }
};

export const assertMigrationFilesAreDeploySafe = () => {
  for (const entry of readdirSync(migrationsDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sql = readFileSync(
      path.join(migrationsDirectory, entry.name, "migration.sql"),
      "utf-8"
    );
    assertMigrationSqlIsDeploySafe(sql, entry.name);
  }
};

if (import.meta.main) {
  assertMigrationFilesAreDeploySafe();
}
