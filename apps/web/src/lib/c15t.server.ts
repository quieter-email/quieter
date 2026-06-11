import { c15tInstance, policyBuilder, policyPackPresets } from "@c15t/backend";
import { kyselyAdapter } from "@c15t/backend/db/adapters/kysely";
import { DB } from "@c15t/backend/db/schema";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

const consentTablePrefix = "c15t_";

const getTrustedOrigins = () => {
  const origins = new Set(["localhost:3000"]);

  for (const value of [process.env.BETTER_AUTH_URL, process.env.VERCEL_URL]) {
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
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the consent backend.");
  }

  return databaseUrl;
};

const getConsentState = () => {
  if (consentState) {
    return consentState;
  }

  const adapter = kyselyAdapter({
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          connectionString: getConsentDatabaseUrl(),
        }),
      }),
    }),
    provider: "postgresql",
  });

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

const ensureConsentMigrations = async () => {
  consentMigrationPromise ??= (async () => {
    try {
      const { adapter } = getConsentState();
      const client = DB.names.prefix(consentTablePrefix).client(adapter);
      const migration = await client.createMigrator().migrateToLatest();
      await migration.execute();
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
