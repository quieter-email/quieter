import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { runKitMigrate } from "./drizzle-kit";

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
    Number(date.slice(12, 14)),
  );
};

export const runForwardMigrations = async (input: {
  databaseUrl: string;
  migrationsDirectory: string;
  packageDirectory: string;
}) => {
  const migrations = readdirSync(input.migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(input.migrationsDirectory, entry.name, "migration.sql"),
    }))
    .filter((migration) => existsSync(migration.path))
    .sort((left, right) => left.name.localeCompare(right.name));
  const migrationSources = await Promise.all(
    migrations.map(async (migration) => ({
      ...migration,
      sql: await Bun.file(migration.path).text(),
    })),
  );
  const nonTransactionalMigrations = migrationSources.filter((migration) =>
    migration.sql.includes(NON_TRANSACTIONAL_MARKER),
  );

  if (nonTransactionalMigrations.length === 0) {
    await runKitMigrate();
    return;
  }

  const sql = postgres(input.databaseUrl, { max: 1 });
  await sql`select pg_advisory_lock(hashtext('quieter-forward-migrations'))`;

  try {
    for (const migration of nonTransactionalMigrations) {
      const temporaryDirectory = mkdtempSync(join(input.packageDirectory, ".migration-prefix-"));
      const prefixDirectory = join(temporaryDirectory, "drizzle");

      try {
        mkdirSync(prefixDirectory, { recursive: true });
        for (const prefixMigration of migrations) {
          if (prefixMigration.name >= migration.name) break;
          cpSync(
            join(input.migrationsDirectory, prefixMigration.name),
            join(prefixDirectory, prefixMigration.name),
            { recursive: true },
          );
        }

        const temporaryConfigPath = join(temporaryDirectory, "drizzle.config.ts");
        writeFileSync(
          temporaryConfigPath,
          `export default { out: ${JSON.stringify(prefixDirectory)}, dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } };\n`,
        );
        await runKitMigrate(temporaryConfigPath);
      } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
      }

      const applied = await sql<{ name: string | null }[]>`
        select name from drizzle.__drizzle_migrations where name = ${migration.name}
      `;
      if (applied.length > 0) continue;

      for (const statement of migration.sql.split(STATEMENT_BREAKPOINT)) {
        const executable = statement.replace(NON_TRANSACTIONAL_MARKER, "").trim();
        if (executable) await sql.unsafe(executable);
      }

      await sql`
        insert into drizzle.__drizzle_migrations (hash, created_at, name)
        values (
          ${createHash("sha256").update(migration.sql).digest("hex")},
          ${toMigrationMillis(migration.name)},
          ${migration.name}
        )
      `;
    }

    await runKitMigrate();
  } finally {
    try {
      await sql`select pg_advisory_unlock(hashtext('quieter-forward-migrations'))`;
    } finally {
      await sql.end();
    }
  }
};
