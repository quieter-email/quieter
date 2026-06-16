import { neon } from "@neondatabase/serverless";
import { serverEnv } from "@quieter/env/server";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { authRelations } from "./schema";

type BatchQuery = PromiseLike<unknown>;
type BatchResult<TBatch extends readonly BatchQuery[]> = {
  [Key in keyof TBatch]: Awaited<TBatch[Key]>;
};

export type DatabaseClient = ReturnType<typeof drizzlePostgres> & {
  batch: <TBatch extends readonly [BatchQuery, ...BatchQuery[]]>(
    batch: TBatch,
  ) => Promise<BatchResult<TBatch>>;
};

const getDatabaseUrl = () => {
  const databaseUrl = serverEnv.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is missing");
  }
  return databaseUrl;
};

const isLocalDatabaseUrl = (databaseUrl: string) => {
  const { hostname } = new URL(databaseUrl);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
};

export const assertDatabaseConfigured = () => {
  getDatabaseUrl();
};

const createDatabaseClient = (): DatabaseClient => {
  const databaseUrl = getDatabaseUrl();

  if (isLocalDatabaseUrl(databaseUrl)) {
    const sql = postgres(databaseUrl);
    const client = drizzlePostgres({
      client: sql,
      relations: authRelations,
    });

    return Object.assign(client, {
      batch: async <TBatch extends readonly [BatchQuery, ...BatchQuery[]]>(batch: TBatch) => {
        const results: unknown[] = [];
        for (const query of batch) {
          results.push(await query);
        }
        return results as BatchResult<TBatch>;
      },
    });
  }

  const sql = neon(databaseUrl);
  return drizzle({
    client: sql,
    relations: authRelations,
  }) as unknown as DatabaseClient;
};

let databaseClient: DatabaseClient | undefined;

const getDatabaseClient = () => {
  databaseClient ??= createDatabaseClient();
  return databaseClient;
};

export const db = new Proxy({} as DatabaseClient, {
  get: (_target, property) => Reflect.get(getDatabaseClient(), property),
});
