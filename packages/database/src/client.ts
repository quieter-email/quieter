import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { authRelations } from "./schema";

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is missing");
  }
  return databaseUrl;
};

export const assertDatabaseConfigured = () => {
  getDatabaseUrl();
};

const createDatabaseClient = () => {
  const sql = neon(getDatabaseUrl());
  return drizzle({
    client: sql,
    relations: authRelations,
  });
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

let databaseClient: DatabaseClient | undefined;

const getDatabaseClient = () => {
  databaseClient ??= createDatabaseClient();
  return databaseClient;
};

export const db = new Proxy({} as DatabaseClient, {
  get: (_target, property) => Reflect.get(getDatabaseClient(), property),
});
