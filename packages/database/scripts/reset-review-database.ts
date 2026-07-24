import postgres from "postgres";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";

const REVIEW_APP_ROLE = "quieter_review_app";

if (process.env.QUIETER_REVIEW_DEPLOYMENT !== "true") {
  throw new Error("Review database resets are restricted to Review deployment jobs");
}

const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT USAGE ON SCHEMA public TO public;
    GRANT ALL ON SCHEMA public TO CURRENT_USER;
    GRANT USAGE ON SCHEMA public TO ${REVIEW_APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${REVIEW_APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${REVIEW_APP_ROLE};
  `);

  console.log(`Reset Review database schemas for ${REVIEW_APP_ROLE}`);
} finally {
  await sql.end({ timeout: 5 });
}
