import { serverEnv } from "@quieter/env/server";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { authRelations } from "./schema";

export type DatabaseClient = ReturnType<typeof drizzlePostgres>;

const getDatabaseUrl = () => {
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
    max: 10,
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
