import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const migrationSql = readFileSync(join(migrationDirectory, "migration.sql"), "utf8");
const expectedSnapshot = JSON.parse(
  readFileSync(join(migrationDirectory, "snapshot.json"), "utf8"),
) as Snapshot;
const databaseUrl = getMigrationDatabaseUrl();
const sql = postgres(databaseUrl, { max: 1 });

const normalizeSnapshot = (snapshot: Snapshot) => {
  const { id: _id, prevIds: _prevIds, ...normalized } = snapshot;
  return JSON.stringify(normalized);
};

const findSnapshot = (directory: string): string | undefined => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      const snapshot = findSnapshot(path);
      if (snapshot) {
        return snapshot;
      }
    } else if (entry.name === "snapshot.json") {
      return path;
    }
  }
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
  const hash = createHash("sha256").update(migrationSql).digest("hex");

  if (history.length > 0) {
    if (history[0]?.name === migrationName && history[0]?.hash === hash) {
      console.log("Production database already has the expected migration history.");
    } else {
      throw new Error("Production contains an unexpected Drizzle migration history");
    }
  } else {
    const expectedTableNames = expectedSnapshot.ddl
      .filter((entity) => entity.entityType === "tables")
      .map((entity) => entity.name);
    const existingTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${expectedTableNames})
    `;

    if (existingTables.length === 0) {
      console.log("Production database is empty; migrations will create the schema.");
    } else {
      const temporaryDirectory = mkdtempSync(join(tmpdir(), "quieter-drizzle-baseline-"));
      const pulledMigrationsDirectory = join(temporaryDirectory, "drizzle");
      const temporaryConfigPath = join(temporaryDirectory, "drizzle.config.ts");

      try {
        writeFileSync(
          temporaryConfigPath,
          `export default ${JSON.stringify({
            dbCredentials: { url: databaseUrl },
            dialect: "postgresql",
            out: pulledMigrationsDirectory,
            schema: join(packageDirectory, "src/schema.ts"),
            strict: true,
            tablesFilter: expectedTableNames,
          })};\n`,
        );

        const pull = Bun.spawn(["bunx", "drizzle-kit", "pull", `--config=${temporaryConfigPath}`], {
          cwd: packageDirectory,
          env: {
            ...globalThis.process.env,
            DATABASE_URL: databaseUrl,
          },
          stderr: "inherit",
          stdout: "inherit",
        });

        if ((await pull.exited) !== 0) {
          throw new Error("Failed to introspect the production database");
        }

        const pulledSnapshotPath = findSnapshot(pulledMigrationsDirectory);
        if (!pulledSnapshotPath) {
          throw new Error("Drizzle did not produce a production schema snapshot");
        }

        const pulledSnapshot = JSON.parse(readFileSync(pulledSnapshotPath, "utf8")) as Snapshot;

        if (normalizeSnapshot(pulledSnapshot) !== normalizeSnapshot(expectedSnapshot)) {
          throw new Error(
            "Production schema does not match the committed baseline; reconcile it before deployment",
          );
        }

        await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
        await sql`
        CREATE TABLE drizzle.__drizzle_migrations (
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
        console.log(`Automatically registered production baseline ${migrationName}.`);
      } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
      }
    }
  }
} finally {
  await sql.end();
}
