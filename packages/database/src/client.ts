import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { authRelations, tables } from "./schema";

const FALLBACK_DATABASE_URL = "postgresql://quieter:quieter@127.0.0.1:5432/quieter";
const databaseUrl = process.env.DATABASE_URL?.trim() || FALLBACK_DATABASE_URL;

export const assertDatabaseConfigured = () => {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL environment variable is missing");
  }
};

const sql = neon(databaseUrl);
export const db = drizzle({
  client: sql,
  schema: tables,
  relations: authRelations,
});

export type DatabaseClient = typeof db;
