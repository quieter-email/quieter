import { AsyncLocalStorage } from "node:async_hooks";

import { serverEnv } from "@quieter/env/server";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Resource } from "sst";

import { authRelations } from "./schema";

export type DatabaseClient = ReturnType<typeof drizzlePostgres>;

const isPresentString = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

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

  if (isPresentString(linkedConnectionString)) {
    return linkedConnectionString;
  }

  const databaseUrl = serverEnv.DATABASE_URL;
  if (!isPresentString(databaseUrl)) {
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
  const scopedClient = requestDatabaseClient.getStore();

  if (scopedClient) {
    return scopedClient;
  }

  const linkedConnectionString = getLinkedHyperdriveConnectionString();

  if (isPresentString(linkedConnectionString)) {
    return createDatabaseClient(linkedConnectionString);
  }

  directDatabaseClient ??= createDatabaseClient();
  return directDatabaseClient;
};

type RequestDatabaseRun<Result> =
  | ((client: DatabaseClient) => Result | Promise<Result>)
  | (() => Result | Promise<Result>);

const isClientRun = <Result>(
  run: RequestDatabaseRun<Result>
): run is (client: DatabaseClient) => Result | Promise<Result> =>
  run.length > 0;

const executeRequestDatabaseRun = async <Result>(
  run: RequestDatabaseRun<Result>,
  client: DatabaseClient
): Promise<Result> => {
  if (isClientRun(run)) {
    return await run(client);
  }
  const runWithoutClient = run as () => Result | Promise<Result>;
  return await runWithoutClient();
};

export const withRequestDatabaseClient = async <Result>(
  run: RequestDatabaseRun<Result>
): Promise<Result> => {
  const requestClient = requestDatabaseClient.getStore();
  if (requestClient) {
    return await executeRequestDatabaseRun(run, requestClient);
  }

  const client = createDatabaseClient();
  return await requestDatabaseClient.run(
    client,
    async () => await executeRequestDatabaseRun(run, client)
  );
};

const databaseProxyHandler: ProxyHandler<DatabaseClient> = {
  get(_target, property): unknown {
    const client = getDatabaseClient();
    const value: unknown = Reflect.get(client, property);
    if (typeof value === "function") {
      return (...args: unknown[]) =>
        Reflect.apply(value, client, args) as unknown;
    }
    return value;
  },
};

export const db = new Proxy(getDatabaseClient(), databaseProxyHandler);
