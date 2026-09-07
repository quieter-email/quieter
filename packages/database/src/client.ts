import { AsyncLocalStorage } from "node:async_hooks";

import { serverEnv } from "@quieter/env/server";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Resource } from "sst";

import { authRelations } from "./schema.ts";

export type DatabaseClient = ReturnType<typeof drizzlePostgres>;
export type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
export type DatabaseExecutor = DatabaseClient | DatabaseTransaction;

const getLinkedHyperdriveConnectionString = (): string | undefined => {
  try {
    const appDatabase: unknown = Reflect.get(Resource, "AppDatabaseV2");
    if (typeof appDatabase !== "object" || appDatabase === null) {
      return undefined;
    }

    const connectionString: unknown = Reflect.get(
      appDatabase,
      "connectionString"
    );
    if (typeof connectionString !== "string" || connectionString === "") {
      return undefined;
    }
    return connectionString;
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

const createDatabaseClient = (
  databaseUrl = getDatabaseUrl()
): DatabaseClient => {
  const hyperdrive = databaseUrl === getLinkedHyperdriveConnectionString();
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    fetch_types: false,
    max: serverEnv.QUIETER_DEPLOYMENT_ENV === "local" ? 1 : 5,
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
  const scopedClient = requestDatabaseClient.getStore();

  if (scopedClient) {
    return scopedClient;
  }

  const linkedConnectionString = getLinkedHyperdriveConnectionString();

  if (linkedConnectionString) {
    return createDatabaseClient(linkedConnectionString);
  }

  directDatabaseClient ??= createDatabaseClient();
  return directDatabaseClient;
};

export const withRequestDatabaseClient = async <Result>(
  run: (client: DatabaseClient) => Result | Promise<Result>
): Promise<Result> => {
  const requestClient = requestDatabaseClient.getStore();
  if (requestClient) {
    return await run(requestClient);
  }

  const client = createDatabaseClient();
  return await requestDatabaseClient.run(client, async () => await run(client));
};

const databaseProxyHandler: ProxyHandler<DatabaseClient> = {
  get(_target, property): unknown {
    const client = getDatabaseClient();
    const value: unknown = Reflect.get(client, property);
    if (typeof value === "function" && property !== "$client") {
      return (...args: unknown[]) =>
        Reflect.apply(value, client, args) as unknown;
    }
    return value;
  },
};

// The handler ignores the target; this inert object prevents import-time client creation.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const db = new Proxy({} as DatabaseClient, databaseProxyHandler);
