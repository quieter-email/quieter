import { c15tInstance, policyBuilder, policyPackPresets } from "@c15t/backend";
import { kyselyAdapter } from "@c15t/backend/db/adapters/kysely";
import { DB } from "@c15t/backend/db/schema";
import { serverEnv } from "@quieter/env/server";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

const consentTablePrefix = "c15t_";
const consentMigrationLockKey1 = 0x715f6331;
const consentMigrationLockKey2 = 0x745f6d69;

const getTrustedOrigins = () => {
  const origins = new Set(["localhost:3000"]);

  for (const value of [serverEnv.BETTER_AUTH_URL, serverEnv.VERCEL_URL]) {
    const origin = value
      ?.trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    if (origin) {
      origins.add(origin);
    }
  }

  return [...origins];
};

const policyPacks = policyBuilder.composePacks(
  [policyPackPresets.europeOptIn()],
  [policyPackPresets.californiaOptOut()],
  [policyPackPresets.worldNoBanner()],
);

let consentMigrationPromise: Promise<void> | undefined;
let consentState:
  | {
      adapter: ReturnType<typeof kyselyAdapter>;
      backend: ReturnType<typeof c15tInstance>;
    }
  | undefined;

const getConsentDatabaseUrl = () => {
  const databaseUrl = serverEnv.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the consent backend.");
  }

  return databaseUrl;
};

const toDirectPostgresUrl = (value: string) => {
  const url = new URL(value);

  if (url.hostname.includes("-pooler")) {
    url.hostname = url.hostname.replace("-pooler", "");
  }

  url.searchParams.delete("pgbouncer");

  return url.toString();
};

const getConsentMigrationDatabaseUrl = () => {
  const value = serverEnv.DATABASE_MIGRATION_URL ?? serverEnv.DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required for consent migrations.");
  }

  return toDirectPostgresUrl(value);
};

const withConsentMigrationLock = async <T>(callback: (databaseUrl: string) => Promise<T>) => {
  const databaseUrl = getConsentMigrationDatabaseUrl();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
  });
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      consentMigrationLockKey1,
      consentMigrationLockKey2,
    ]);
    return await callback(databaseUrl);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        consentMigrationLockKey1,
        consentMigrationLockKey2,
      ]);
    } finally {
      client.release();
      await pool.end();
    }
  }
};

const createConsentAdapter = (databaseUrl: string) => {
  const database = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: databaseUrl,
      }),
    }),
  });

  return {
    adapter: kyselyAdapter({
      db: database,
      provider: "postgresql",
    }),
    database,
  };
};

const getConsentState = () => {
  if (consentState) {
    return consentState;
  }

  const { adapter } = createConsentAdapter(getConsentDatabaseUrl());

  consentState = {
    adapter,
    backend: c15tInstance({
      adapter,
      appName: "quieter",
      basePath: "/api/c15t",
      policyPacks,
      tablePrefix: consentTablePrefix,
      trustedOrigins: getTrustedOrigins(),
    }),
  };
  return consentState;
};

const executeConsentMigrations = async (databaseUrl: string) => {
  const { adapter, database } = createConsentAdapter(databaseUrl);

  try {
    const client = DB.names.prefix(consentTablePrefix).client(adapter);
    const migration = await client.createMigrator().migrateToLatest();
    await migration.execute();
  } finally {
    await database.destroy();
  }
};

export const runConsentMigrations = async () => {
  await withConsentMigrationLock(executeConsentMigrations);
};

const ensureConsentMigrations = async () => {
  consentMigrationPromise ??= (async () => {
    try {
      await runConsentMigrations();
    } catch (error) {
      consentMigrationPromise = undefined;
      throw error;
    }
  })();

  await consentMigrationPromise;
};

export const initializeConsentBackend = async () => {
  await ensureConsentMigrations();
  return getConsentState().backend;
};
