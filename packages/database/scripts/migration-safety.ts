import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadModule, parseSync } from "libpg-query";
import type { ParseResult } from "libpg-query";

import historicalMigrations from "./historical-migrations.json" with { type: "json" };

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = path.join(packageDirectory, "drizzle");
// Freeze existing history. New destructive SQL must be an explicitly marked,
// manually reviewed contract migration.
const historicalHashes = new Map(Object.entries(historicalMigrations));
await loadModule();

export const assertMigrationSqlIsDeploySafe = (
  sql: string,
  migrationName: string
) => {
  const historicalHash = historicalHashes.get(migrationName);
  if (
    historicalHash !== undefined &&
    createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex") ===
      historicalHash
  ) {
    return;
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The parser returns its exported AST shape but declares the entry point as any.
  const parsed = parseSync(sql) as ParseResult;
  const isNonTransactional = /^-- quieter:no-transaction(?:\r?\n|$)/u.test(sql);
  // Destructive contract SQL is only accepted when the migration opts in
  // explicitly. The marker is reviewed like the SQL it guards and must stay at
  // the top of the generated migration.
  const isContract = /^-- quieter:contract(?:\r?\n|$)/u.test(sql);
  if (isContract) {
    return;
  }
  const createdTables = new Set<string>();
  for (const { stmt } of parsed.stmts ?? []) {
    if (!stmt) {
      throw new Error(
        `Migration ${migrationName} has an unrecognized statement.`
      );
    }
    if (
      isNonTransactional &&
      !("IndexStmt" in stmt && stmt.IndexStmt.concurrent === true)
    ) {
      throw new Error(
        `Migration ${migrationName} opts out of transactions without exclusively creating concurrent indexes.`
      );
    }
    if ("IndexStmt" in stmt) {
      if (stmt.IndexStmt.concurrent === true && !isNonTransactional) {
        throw new Error(
          `Migration ${migrationName} creates a concurrent index without the -- quieter:no-transaction marker.`
        );
      }
      const { relation, unique } = stmt.IndexStmt;
      if (
        unique !== true ||
        createdTables.has(
          JSON.stringify([relation?.schemaname ?? "public", relation?.relname])
        )
      ) {
        continue;
      }
    }
    if (
      "CreateStmt" in stmt &&
      (stmt.CreateStmt.inhRelations?.length ?? 0) === 0 &&
      !stmt.CreateStmt.partbound
    ) {
      const { relation } = stmt.CreateStmt;
      if (stmt.CreateStmt.if_not_exists !== true) {
        createdTables.add(
          JSON.stringify([relation?.schemaname ?? "public", relation?.relname])
        );
      }
      continue;
    }
    if ("CreateEnumStmt" in stmt) {
      continue;
    }
    if ("AlterTableStmt" in stmt) {
      const { cmds, relation } = stmt.AlterTableStmt;
      const isNewTable = createdTables.has(
        JSON.stringify([relation?.schemaname ?? "public", relation?.relname])
      );
      if (
        cmds !== undefined &&
        cmds.length > 0 &&
        cmds.every((node) => {
          if (!("AlterTableCmd" in node)) {
            return false;
          }
          const { subtype, def } = node.AlterTableCmd;
          if (
            subtype === "AT_DropNotNull" ||
            subtype === "AT_ValidateConstraint"
          ) {
            return true;
          }
          if (subtype === "AT_AddConstraint") {
            return isNewTable;
          }
          if (subtype !== "AT_AddColumn" || !def || !("ColumnDef" in def)) {
            return false;
          }
          const column = def.ColumnDef;
          return (
            isNewTable ||
            (column.is_not_null !== true &&
              !column.raw_default &&
              (column.identity ?? "") === "" &&
              (column.generated ?? "") === "" &&
              (column.constraints ?? []).every(
                (constraint) =>
                  "Constraint" in constraint &&
                  constraint.Constraint.contype === "CONSTR_NULL"
              ))
          );
        })
      ) {
        continue;
      }
    }
    throw new Error(
      `Migration ${migrationName} contains destructive SQL or an operation outside the additive allowlist (${Object.keys(stmt).join(", ")}). Use a separately reviewed manual procedure for contract changes, data updates, defaults, and constraints on existing tables.`
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
