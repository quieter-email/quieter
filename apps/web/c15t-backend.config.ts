import { kyselyAdapter } from "@c15t/backend/db/adapters/kysely";
import { defineConfig } from "@c15t/backend/define-config";
import { Kysely, PostgresDialect } from "kysely";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const loadEnvFile = (path: string) => {
  try {
    const contents = readFileSync(path, "utf8");

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore missing env files.
  }
};

loadEnvFile(resolve(import.meta.dirname, "../../.env.local"));
loadEnvFile(resolve(import.meta.dirname, "../../.env"));

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for c15t backend configuration.");
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
});

const kysely = new Kysely({
  dialect: new PostgresDialect({
    pool,
  }),
});

export default defineConfig({
  adapter: kyselyAdapter({
    db: kysely,
    provider: "postgresql",
  }),
  appName: "quieter",
  tablePrefix: "c15t_",
  trustedOrigins: [
    "localhost:3000",
    process.env.BETTER_AUTH_URL?.replace(/^https?:\/\//, "") ?? "localhost:3000",
    process.env.VERCEL_URL ?? "",
  ].filter(Boolean),
});
