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

import { isNotNull } from "drizzle-orm";
import { bigint, pgSchema, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { assertMigrationExecutionAllowed } from "./database-url.ts";
import { runKitMigrate } from "./drizzle-kit.ts";

const NON_TRANSACTIONAL_MARKER = /^-- quieter:no-transaction(?:\r?\n|$)/u;
const PERSONAL_ACTION_CUTOVER_MIGRATIONS = new Set([
  "20261104164249_stale_maggott",
  "20261104170538_invalidate_pre_membership_authority",
]);
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export const migrationLedger = pgSchema("drizzle").table(
  "__drizzle_migrations",
  {
    createdAt: bigint("created_at", { mode: "number" }),
    hash: text("hash").notNull(),
    id: serial("id").primaryKey(),
    name: text("name"),
  }
);

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
    for (const prefixMigration of migrations) {
      if (prefixMigration.name >= migration.name) {
        break;
      }
      cpSync(
        path.join(input.migrationsDirectory, prefixMigration.name),
        path.join(prefixDirectory, prefixMigration.name),
        { recursive: true }
      );
    }

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

  for (const statement of migration.sql.split(STATEMENT_BREAKPOINT)) {
    const executable = statement.replace(NON_TRANSACTIONAL_MARKER, "").trim();
    if (executable !== "") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Migration statements must run sequentially.
      await sql.unsafe(executable);
    }
  }

  await drizzle({ client: sql })
    .insert(migrationLedger)
    .values({
      createdAt: toMigrationMillis(migration.name),
      hash: createHash("sha256").update(migration.sql).digest("hex"),
      name: migration.name,
    });
};

export const runForwardMigrations = async (
  input: {
    databaseUrl: string;
    migrationsDirectory: string;
    packageDirectory: string;
  },
  environment: Record<string, string | undefined> = process.env
) => {
  const target = assertMigrationExecutionAllowed(
    input.databaseUrl,
    environment
  );
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
    NON_TRANSACTIONAL_MARKER.test(migration.sql)
  );

  const sql = postgres(input.databaseUrl, { max: 1 });
  const database = drizzle({ client: sql });
  await sql`select pg_advisory_lock(hashtext('quieter-forward-migrations'))`;

  try {
    const migrationTableRows = await sql<{ exists: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as exists
    `;
    const migrationTableExists = migrationTableRows[0]?.exists ?? false;
    const appliedNameRows = migrationTableExists
      ? await database
          .select({ name: migrationLedger.name })
          .from(migrationLedger)
          .where(isNotNull(migrationLedger.name))
      : [];
    const appliedNames = new Set(
      appliedNameRows.flatMap(({ name }) =>
        name !== null && name !== undefined && name !== "" ? [name] : []
      )
    );
    if (
      target === "production" &&
      migrations.some(
        ({ name }) =>
          PERSONAL_ACTION_CUTOVER_MIGRATIONS.has(name) &&
          !appliedNames.has(name)
      ) &&
      !(
        environment.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        environment.QUIETER_PERSONAL_ACTION_CUTOVER_ACKNOWLEDGED === "true"
      )
    ) {
      throw new Error(
        "Personal Action cutover is pending. Block old Action and mailbox-grant writes while preserving health and read endpoints, stop or drain old Action workers, then run the protected production workflow manually with personal_action_cutover_acknowledged enabled. Keep the writer block through migration and deployment. No migrations have been applied."
      );
    }
    const pendingNonTransactionalMigrations = nonTransactionalMigrations.filter(
      ({ name }) => !appliedNames.has(name)
    );

    if (pendingNonTransactionalMigrations.length === 0) {
      runKitMigrate();
      return;
    }

    for (const migration of pendingNonTransactionalMigrations) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Apply each historical migration before its successors.
      await applyNonTransactionalMigration({
        input,
        migration,
        migrations,
        sql,
      });
    }

    runKitMigrate();
  } finally {
    try {
      await sql`select pg_advisory_unlock(hashtext('quieter-forward-migrations'))`;
    } finally {
      await sql.end();
    }
  }
};
