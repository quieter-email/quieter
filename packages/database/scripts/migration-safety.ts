import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = join(packageDirectory, "drizzle");
const destructiveStatements = [
  /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
];

export const assertMigrationSqlIsDeploySafe = (sql: string, migrationName: string) => {
  if (destructiveStatements.some((pattern) => pattern.test(sql))) {
    throw new Error(
      `Migration ${migrationName} contains destructive SQL. Production deploys only allow expand-safe migrations; run contract migrations through a separately reviewed manual procedure.`,
    );
  }
};

export const assertMigrationFilesAreDeploySafe = () => {
  for (const entry of readdirSync(migrationsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sql = readFileSync(join(migrationsDirectory, entry.name, "migration.sql"), "utf8");
    assertMigrationSqlIsDeploySafe(sql, entry.name);
  }
};

if (import.meta.main) {
  assertMigrationFilesAreDeploySafe();
}
