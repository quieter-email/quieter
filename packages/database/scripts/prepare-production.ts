import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getMigrationDatabaseUrl } from "./database-url";

type Snapshot = Record<string, unknown> & {
  ddl: Array<{
    entityType: string;
    name: string;
  }>;
};

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = join(packageDirectory, "drizzle");
const migrationDirectories = readdirSync(migrationsDirectory, {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(migrationsDirectory, entry.name, "migration.sql")),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

if (migrationDirectories.length === 0) {
  throw new Error("No committed database migrations were found");
}

const migrationName = migrationDirectories[0]!.name;
const migrationDirectory = join(migrationsDirectory, migrationName);
const expectedSnapshot = JSON.parse(
  readFileSync(join(migrationDirectory, "snapshot.json"), "utf8"),
) as Snapshot;
const committedMigrationNames = new Set(migrationDirectories.map((entry) => entry.name));
const migrationHashByName = new Map(
  migrationDirectories.map((entry) => {
    const sql = readFileSync(join(migrationsDirectory, entry.name, "migration.sql"), "utf8");
    return [entry.name, createHash("sha256").update(sql).digest("hex")] as const;
  }),
);
const expectedTableNames = expectedSnapshot.ddl
  .filter((entity) => entity.entityType === "tables")
  .map((entity) => entity.name);
const databaseUrl = getMigrationDatabaseUrl();
const sql = postgres(databaseUrl, { max: 1 });
const hash = migrationHashByName.get(migrationName)!;

const isCommittedMigration = (name: string | null): name is string =>
  name !== null && committedMigrationNames.has(name);

const registerBaseline = async () => {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint,
      name text,
      applied_at timestamp with time zone DEFAULT now()
    )
  `;

  const timestamp = basename(migrationName).slice(0, 14);
  const createdAt = Date.UTC(
    Number(timestamp.slice(0, 4)),
    Number(timestamp.slice(4, 6)) - 1,
    Number(timestamp.slice(6, 8)),
    Number(timestamp.slice(8, 10)),
    Number(timestamp.slice(10, 12)),
    Number(timestamp.slice(12, 14)),
  );

  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at, name)
    VALUES (${hash}, ${createdAt}, ${migrationName})
  `;
};

const assertBaselineTablesPresent = async () => {
  const existingTables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTableNames})
  `;

  if (existingTables.length !== expectedTableNames.length) {
    throw new Error(
      "Database is missing baseline tables; run db:push locally or reconcile the schema before migrating",
    );
  }
};

const adoptBaseline = async (message: string) => {
  await assertBaselineTablesPresent();
  await registerBaseline();
  console.log(message);
};

try {
  const migrationTable = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'drizzle'
        AND table_name = '__drizzle_migrations'
    ) AS exists
  `;
  const history = migrationTable[0]?.exists
    ? await sql`
        SELECT hash, name
        FROM drizzle.__drizzle_migrations
        ORDER BY id
      `
    : [];
  const hasLegacyHistory = history.some(
    (entry) =>
      !isCommittedMigration(entry.name) || entry.hash !== migrationHashByName.get(entry.name),
  );
  const historyMatchesCommittedMigrations =
    history.length > 0 &&
    history.every(
      (entry) =>
        isCommittedMigration(entry.name) && entry.hash === migrationHashByName.get(entry.name),
    ) &&
    history.some((entry) => entry.name === migrationName && entry.hash === hash);

  if (historyMatchesCommittedMigrations) {
    console.log("Database migration history matches committed migrations.");
  } else if (hasLegacyHistory) {
    await sql`DELETE FROM drizzle.__drizzle_migrations`;
    await adoptBaseline(`Rebased migration history onto ${migrationName}.`);
  } else if (history.length > 0) {
    throw new Error("Database contains an unexpected Drizzle migration history");
  } else {
    const existingTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${expectedTableNames})
    `;

    if (existingTables.length === 0) {
      console.log("Database is empty; migrations will create the schema.");
    } else {
      await adoptBaseline(`Automatically registered baseline ${migrationName}.`);
    }
  }
} finally {
  await sql.end();
}
