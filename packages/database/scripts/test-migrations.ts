import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getMigrationDatabaseUrl } from "./database-url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = join(packageDirectory, "drizzle");
const migrationNames = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (migrationNames.length < 2) {
  throw new Error("Migration integration tests require a baseline and a forward migration");
}

const databaseUrl = getMigrationDatabaseUrl();
const sql = postgres(databaseUrl, { max: 1 });
const temporaryDirectory = mkdtempSync(join(packageDirectory, ".migration-test-"));

const runMigrations = async (configPath = join(packageDirectory, "drizzle.config.ts")) => {
  const process = Bun.spawn(["bunx", "drizzle-kit", "migrate", `--config=${configPath}`], {
    cwd: packageDirectory,
    env: {
      ...globalThis.process.env,
      DATABASE_URL: databaseUrl,
    },
    stderr: "inherit",
    stdout: "inherit",
  });

  if ((await process.exited) !== 0) {
    throw new Error("Drizzle migration command failed");
  }
};

const resetDatabase = async () => {
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
};

const assertMigrationHistory = async () => {
  const history = await sql`
    SELECT name
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `;
  const appliedNames = history.map((entry) => entry.name);

  if (
    appliedNames.length !== migrationNames.length ||
    appliedNames.some((name, index) => name !== migrationNames[index])
  ) {
    throw new Error(
      `Expected migration history ${migrationNames.join(", ")}, received ${appliedNames.join(", ")}`,
    );
  }
};

try {
  await resetDatabase();
  await runMigrations();
  await assertMigrationHistory();

  await runMigrations();
  await assertMigrationHistory();

  await resetDatabase();

  const baselineDirectory = join(temporaryDirectory, "drizzle");
  const baselineName = migrationNames[0]!;
  cpSync(join(migrationsDirectory, baselineName), join(baselineDirectory, baselineName), {
    recursive: true,
  });

  const temporaryConfigPath = join(temporaryDirectory, "drizzle.config.ts");
  writeFileSync(
    temporaryConfigPath,
    `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: ${JSON.stringify(baselineDirectory)},
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`,
  );

  await runMigrations(temporaryConfigPath);
  await runMigrations();
  await assertMigrationHistory();
} finally {
  await sql.end();
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
