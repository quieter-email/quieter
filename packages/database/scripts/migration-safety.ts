import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = path.join(packageDirectory, "drizzle");
// Preserve the already committed contract history without allowing new comment-based bypasses.
const historicalContracts = new Map([
  [
    "20260819222359_concerned_the_watchers",
    "03447a76e82a7b1493ce3e1955e5ced29ef0a5381a4958915434f12505563a1b",
  ],
  [
    "20260820224503_elite_overlord",
    "17f03052f7984c7fdd6639fd02ea48d9370d74722f137c160df538a558322269",
  ],
  [
    "20260821175937_flimsy_elektra",
    "b91bb43c096c9e221ebdedf347dbc819e737c5eb82f5efdbad4e729b8c43f95e",
  ],
  [
    "20260821213731_light_princess_powerful",
    "562ee4061f8f2864ed2f732491faeea94dfc1438d30165ccdc8de7ff86a37e3a",
  ],
]);
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
  const historicalHash = historicalContracts.get(migrationName);
  if (
    historicalHash !== undefined &&
    createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex") ===
      historicalHash
  ) {
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
