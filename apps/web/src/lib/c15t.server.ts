import { c15tInstance, policyBuilder, policyPackPresets } from "@c15t/backend";
import { kyselyAdapter } from "@c15t/backend/db/adapters/kysely";
import { DB } from "@c15t/backend/db/schema";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

const consentTablePrefix = "c15t_";

const getTrustedOrigins = () => {
  const origins = new Set<string>(["localhost:3000"]);

  const betterAuthUrl = process.env.BETTER_AUTH_URL?.trim();
  if (betterAuthUrl) {
    origins.add(betterAuthUrl.replace(/^https?:\/\//, ""));
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    origins.add(vercelUrl);
  }

  return [...origins];
};

const policyPacks = policyBuilder.composePacks(
  [policyPackPresets.europeOptIn()],
  [policyPackPresets.californiaOptOut()],
  [policyPackPresets.worldNoBanner()],
);

const createConsentKysely = (pool: pg.Pool) =>
  new Kysely({
    dialect: new PostgresDialect({
      pool,
    }),
  });

let consentBackend: ReturnType<typeof c15tInstance> | undefined;
let consentMigrationPromise: Promise<void> | undefined;
let consentPool: pg.Pool | undefined;
let consentKysely: ReturnType<typeof createConsentKysely> | undefined;
let consentAdapter: ReturnType<typeof kyselyAdapter> | undefined;

const getConsentDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the consent backend.");
  }

  return databaseUrl;
};

const getConsentAdapter = () => {
  consentPool ??= new pg.Pool({
    connectionString: getConsentDatabaseUrl(),
  });
  consentKysely ??= createConsentKysely(consentPool);
  consentAdapter ??= kyselyAdapter({
    db: consentKysely as unknown as Parameters<typeof kyselyAdapter>[0]["db"],
    provider: "postgresql",
  });

  return consentAdapter;
};

const ensureConsentMigrations = async () => {
  consentMigrationPromise ??= (async () => {
    const adapter = getConsentAdapter();
    const client = DB.names.prefix(consentTablePrefix).client(adapter);
    const migration = await client.createMigrator().migrateToLatest();
    await migration.execute();
  })();

  await consentMigrationPromise;
};

export const getConsentBackend = () => {
  consentBackend ??= c15tInstance({
    adapter: getConsentAdapter(),
    appName: "quieter",
    basePath: "/api/c15t",
    policyPacks,
    tablePrefix: consentTablePrefix,
    trustedOrigins: getTrustedOrigins(),
  });

  return consentBackend;
};

export const initializeConsentBackend = async () => {
  await ensureConsentMigrations();
  return getConsentBackend();
};
