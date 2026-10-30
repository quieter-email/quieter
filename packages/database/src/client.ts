import { AsyncLocalStorage } from "node:async_hooks";

import { serverEnv } from "@quieter/env/server";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Resource } from "sst";

import { assertLocalDevelopmentDatabaseUrl } from "../scripts/local-development.ts";
import { authRelations } from "./schema.ts";

declare const __QUIETER_LOCAL_DEVELOPMENT__: boolean;

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

  const databaseUrl = linkedConnectionString ?? serverEnv.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is missing");
  }
  if (
    // oxlint-disable-next-line unicorn/no-typeof-undefined -- Node callers do not receive Vite's compile-time marker.
    (typeof __QUIETER_LOCAL_DEVELOPMENT__ !== "undefined" &&
      __QUIETER_LOCAL_DEVELOPMENT__) ||
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
  ) {
    assertLocalDevelopmentDatabaseUrl("DATABASE_URL", databaseUrl, {
      QUIETER_DEPLOYMENT_ENV: "local",
      QUIETER_LOCAL_PLANETSCALE_HOST: serverEnv.QUIETER_LOCAL_PLANETSCALE_HOST,
    });
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
    idle_timeout: 20,
    max: serverEnv.QUIETER_DEPLOYMENT_ENV === "local" ? 1 : 5,
    prepare: hyperdrive,
  });
  return drizzlePostgres({
    client: sql,
    relations: authRelations,
  });
};

const requestDatabaseClient = new AsyncLocalStorage<DatabaseClient>();
const isWorker =
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";
let directDatabaseClient: DatabaseClient | undefined;

const getDatabaseClient = () => {
  const scopedClient = requestDatabaseClient.getStore();

  if (scopedClient) {
    return scopedClient;
  }

  if (isWorker || getLinkedHyperdriveConnectionString()) {
    throw new Error(
      "Worker database access requires withRequestDatabaseClient."
    );
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

  // Workers own request-local sockets; Node reuses one bounded process pool.
  const client =
    isWorker || getLinkedHyperdriveConnectionString()
      ? createDatabaseClient()
      : getDatabaseClient();
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
