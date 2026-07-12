import { serverEnv } from "@quieter/env/server";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Resource } from "sst";
import { authRelations } from "./schema";

export type DatabaseClient = ReturnType<typeof drizzlePostgres>;

const getLinkedHyperdriveConnectionString = () => {
  try {
    const appDatabase = Reflect.get(Resource, "AppDatabase") as
      | { connectionString?: string }
      | undefined;
    const connectionString = appDatabase?.connectionString;

    return typeof connectionString === "string" && connectionString.length > 0
      ? connectionString
      : undefined;
  } catch {
    return undefined;
  }
};

const getDatabaseUrl = () => {
  const linkedConnectionString = getLinkedHyperdriveConnectionString();

  if (linkedConnectionString) {
    return linkedConnectionString;
  }

  const databaseUrl = serverEnv.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is missing");
  }
  return databaseUrl;
};

export const assertDatabaseConfigured = () => {
  getDatabaseUrl();
};

const createDatabaseClient = (): DatabaseClient => {
  const databaseUrl = getDatabaseUrl();
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    fetch_types: false,
    max: 5,
    prepare: false,
  });
  return drizzlePostgres({
    client: sql,
    relations: authRelations,
  });
};

let databaseClient: DatabaseClient | undefined;

const getDatabaseClient = () => {
  databaseClient ??= createDatabaseClient();
  return databaseClient;
};

export const db = new Proxy({} as DatabaseClient, {
  get: (_target, property) => Reflect.get(getDatabaseClient(), property),
});
