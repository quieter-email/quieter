import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { authRelations, tables } from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is missing");
}

const sql = neon(databaseUrl);
export const db = drizzle({
  client: sql,
  schema: tables,
  relations: authRelations,
});

export type DatabaseClient = typeof db;
