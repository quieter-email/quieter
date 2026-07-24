import postgres from "postgres";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";
import { parseReviewPullRequestNumber, REVIEW_APP_ROLE } from "./review-database";

if (process.env.QUIETER_REVIEW_DEPLOYMENT !== "true") {
  throw new Error("Review database grants are restricted to Review deployment jobs");
}

const pullRequestNumber = parseReviewPullRequestNumber(process.env.REVIEW_PR_NUMBER);
const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA public TO ${REVIEW_APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${REVIEW_APP_ROLE};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${REVIEW_APP_ROLE};
    CREATE SCHEMA IF NOT EXISTS drizzle;
    GRANT USAGE ON SCHEMA drizzle TO ${REVIEW_APP_ROLE};
    CREATE TABLE IF NOT EXISTS drizzle.__quieter_review_deployment (
      id integer PRIMARY KEY CHECK (id = 1),
      pull_request_number integer NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await sql`
    insert into drizzle.__quieter_review_deployment (id, pull_request_number, updated_at)
    values (1, ${pullRequestNumber}, now())
    on conflict (id) do update
    set
      pull_request_number = excluded.pull_request_number,
      updated_at = excluded.updated_at
  `;

  console.log(`Granted Review privileges and marked pull request #${pullRequestNumber}`);
} finally {
  await sql.end({ timeout: 5 });
}
