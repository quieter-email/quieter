import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exitOnKitError, generate } from "./drizzle-kit";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = join(packageDirectory, "drizzle");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "quieter-drizzle-check-"));
const temporaryMigrationsDirectory = join(temporaryDirectory, "drizzle");

try {
  cpSync(migrationsDirectory, temporaryMigrationsDirectory, { recursive: true });
  const migrationNames = new Set(
    readdirSync(temporaryMigrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  const response = await generate({
    dialect: "postgresql",
    schema: "./src/schema.ts",
    out: temporaryMigrationsDirectory,
  });
  exitOnKitError(response);

  const generatedMigrations = readdirSync(temporaryMigrationsDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory() && !migrationNames.has(entry.name))
    .map((entry) => entry.name);

  if (generatedMigrations.length > 0) {
    throw new Error(
      `Schema changes are missing a committed migration: ${generatedMigrations.join(", ")}`,
    );
  }
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
