import { serverEnv } from "@quieter/env/server";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { Resource } from "sst";
import { authRelations } from "./schema";

export type DatabaseClient = ReturnType<typeof drizzlePostgres>;

const getLinkedHyperdriveConnectionString = () => {
  try {
    const appDatabase = Reflect.get(Resource, "AppDatabaseV2") as
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

const createDatabaseClient = (databaseUrl = getDatabaseUrl()): DatabaseClient => {
  const hyperdrive = databaseUrl === getLinkedHyperdriveConnectionString();
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    fetch_types: false,
    max: 5,
    prepare: hyperdrive,
  });
  return drizzlePostgres({
    client: sql,
    relations: authRelations,
  });
};

const requestDatabaseClient = new AsyncLocalStorage<DatabaseClient>();
let directDatabaseClient: DatabaseClient | undefined;

const getDatabaseClient = () => {
  const linkedConnectionString = getLinkedHyperdriveConnectionString();

  if (linkedConnectionString) {
    return requestDatabaseClient.getStore() ?? createDatabaseClient(linkedConnectionString);
  }

  directDatabaseClient ??= createDatabaseClient();
  return directDatabaseClient;
};

export const withRequestDatabaseClient = <Result>(callback: () => Result) => {
  const linkedConnectionString = getLinkedHyperdriveConnectionString();

  if (!linkedConnectionString || requestDatabaseClient.getStore()) {
    return callback();
  }

  return requestDatabaseClient.run(createDatabaseClient(linkedConnectionString), callback);
};

export const db = new Proxy({} as DatabaseClient, {
  get: (_target, property) => Reflect.get(getDatabaseClient(), property),
});
