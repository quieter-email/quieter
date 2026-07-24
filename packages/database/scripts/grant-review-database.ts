import postgres from "postgres";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";

const REVIEW_APP_ROLE = "quieter_review_app";

if (process.env.QUIETER_REVIEW_DEPLOYMENT !== "true") {
  throw new Error("Review database grants are restricted to Review deployment jobs");
}

const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA public TO ${REVIEW_APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${REVIEW_APP_ROLE};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${REVIEW_APP_ROLE};
    GRANT USAGE ON SCHEMA drizzle TO ${REVIEW_APP_ROLE};
  `);

  console.log(`Granted Review application privileges to ${REVIEW_APP_ROLE}`);
} finally {
  await sql.end({ timeout: 5 });
}
