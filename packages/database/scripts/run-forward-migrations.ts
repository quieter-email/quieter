import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { runKitMigrate } from "./drizzle-kit.ts";

const NON_TRANSACTIONAL_MARKER = "-- quieter:no-transaction";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const toMigrationMillis = (name: string) => {
  const date = name.slice(0, 14);
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(date.slice(8, 10)),
    Number(date.slice(10, 12)),
    Number(date.slice(12, 14))
  );
};

const copyPrefixMigrations = (
  migrations: { name: string; path: string }[],
  migrationName: string,
  migrationsDirectory: string,
  prefixDirectory: string
) => {
  for (const prefixMigration of migrations) {
    if (prefixMigration.name >= migrationName) {
      continue;
    }

    cpSync(
      path.join(migrationsDirectory, prefixMigration.name),
      path.join(prefixDirectory, prefixMigration.name),
      { recursive: true }
    );
  }
};

const applyNonTransactionalMigration = async ({
  input,
  migration,
  migrations,
  sql,
}: {
  input: {
    databaseUrl: string;
    migrationsDirectory: string;
    packageDirectory: string;
  };
  migration: { name: string; path: string; sql: string };
  migrations: { name: string; path: string }[];
  sql: postgres.Sql;
}) => {
  const temporaryDirectory = mkdtempSync(
    path.join(input.packageDirectory, ".migration-prefix-")
  );
  const prefixDirectory = path.join(temporaryDirectory, "drizzle");

  try {
    mkdirSync(prefixDirectory, { recursive: true });
    copyPrefixMigrations(
      migrations,
      migration.name,
      input.migrationsDirectory,
      prefixDirectory
    );

    const temporaryConfigPath = path.join(
      temporaryDirectory,
      "drizzle.config.ts"
    );
    writeFileSync(
      temporaryConfigPath,
      `export default { out: ${JSON.stringify(prefixDirectory)}, dialect: "postgresql", dbCredentials: { url: ${JSON.stringify(input.databaseUrl)} } };\n`
    );
    runKitMigrate(temporaryConfigPath);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }

  const statements = migration.sql.split(STATEMENT_BREAKPOINT);
  const executeStatementAt = async (index: number): Promise<void> => {
    if (index >= statements.length) {
      return;
    }

    const executable =
      statements[index]?.replace(NON_TRANSACTIONAL_MARKER, "").trim() ?? "";
    if (executable !== "") {
      await sql.unsafe(executable);
    }

    await executeStatementAt(index + 1);
  };
  await executeStatementAt(0);

  await sql`
    insert into drizzle.__drizzle_migrations (hash, created_at, name)
    values (
      ${createHash("sha256").update(migration.sql).digest("hex")},
      ${toMigrationMillis(migration.name)},
      ${migration.name}
    )
  `;
};

export const runForwardMigrations = async (input: {
  databaseUrl: string;
  migrationsDirectory: string;
  packageDirectory: string;
}) => {
  const migrations = readdirSync(input.migrationsDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(input.migrationsDirectory, entry.name, "migration.sql"),
    }))
    .filter((migration) => existsSync(migration.path))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const migrationSources = migrations.map((migration) => ({
    ...migration,
    sql: readFileSync(migration.path, "utf-8"),
  }));
  const nonTransactionalMigrations = migrationSources.filter((migration) =>
    migration.sql.includes(NON_TRANSACTIONAL_MARKER)
  );

  if (nonTransactionalMigrations.length === 0) {
    runKitMigrate();
    return;
  }

  const sql = postgres(input.databaseUrl, { max: 1 });
  await sql`select pg_advisory_lock(hashtext('quieter-forward-migrations'))`;

  try {
    const migrationTableRows = await sql<{ exists: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as exists
    `;
    const migrationTableExists = migrationTableRows[0]?.exists ?? false;
    const appliedNameRows = migrationTableExists
      ? await sql<{ name: string | null }[]>`
          select name from drizzle.__drizzle_migrations where name is not null
        `
      : [];
    const appliedNames = new Set(
      appliedNameRows.flatMap(({ name }) =>
        name !== null && name !== undefined && name !== "" ? [name] : []
      )
    );
    const pendingNonTransactionalMigrations = nonTransactionalMigrations.filter(
      ({ name }) => !appliedNames.has(name)
    );

    if (pendingNonTransactionalMigrations.length === 0) {
      runKitMigrate();
      return;
    }

    const applyMigrationAt = async (index: number): Promise<void> => {
      if (index >= pendingNonTransactionalMigrations.length) {
        return;
      }

      const migration = pendingNonTransactionalMigrations[index];
      await applyNonTransactionalMigration({
        input,
        migration,
        migrations,
        sql,
      });
      await applyMigrationAt(index + 1);
    };
    await applyMigrationAt(0);

    runKitMigrate();
  } finally {
    try {
      await sql`select pg_advisory_unlock(hashtext('quieter-forward-migrations'))`;
    } finally {
      await sql.end();
    }
  }
};
