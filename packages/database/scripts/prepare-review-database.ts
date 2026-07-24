import postgres from "postgres";
import { assertMigrationExecutionAllowed, getMigrationDatabaseUrl } from "./database-url";
import { parseReviewPullRequestNumber, REVIEW_APP_ROLE } from "./review-database";

if (process.env.QUIETER_REVIEW_DEPLOYMENT !== "true") {
  throw new Error("Review database preparation is restricted to Review deployment jobs");
}

const pullRequestNumber = parseReviewPullRequestNumber(process.env.REVIEW_PR_NUMBER);
const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);

const sql = postgres(databaseUrl, { max: 1 });

try {
  const [{ markerReady }] = await sql<{ markerReady: boolean }[]>`
    select to_regclass('drizzle.__quieter_review_deployment') is not null as "markerReady"
  `;

  let activePullRequestNumber: number | null = null;
  if (markerReady) {
    const rows = await sql<{ pullRequestNumber: number }[]>`
      select pull_request_number as "pullRequestNumber"
      from drizzle.__quieter_review_deployment
      where id = 1
    `;
    activePullRequestNumber = rows[0]?.pullRequestNumber ?? null;
  }

  if (activePullRequestNumber === pullRequestNumber) {
    console.log(`Reusing Review database for pull request #${pullRequestNumber}`);
    process.exit(0);
  }

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

  console.log(
    activePullRequestNumber == null
      ? `Reset Review database for first deploy of pull request #${pullRequestNumber}`
      : `Reset Review database for pull request #${pullRequestNumber} (was #${activePullRequestNumber})`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
