import postgres from "postgres";

const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql`DROP SCHEMA drizzle CASCADE`;
} finally {
  await sql.end();
}
