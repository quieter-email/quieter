import { serverEnv } from "@quieter/env/server";

import {
  getHostname,
  isExplicitLocalPlanetScaleUrl,
  isPresent,
  LOOPBACK_HOSTS,
} from "./local-development";

export {
  assertLocalDatabaseUrl,
  assertLocalDevelopmentDatabaseUrls,
} from "./local-development";

const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "5min";
const PRODUCTION_REPOSITORY = "quieter-email/quieter";
const productionMigrationTarget = {
  protectedRef: true,
  ref: "refs/heads/main",
} as const;

const assertDirectMigrationDatabaseUrl = (value: string) => {
  const url = new URL(value);
  const hostname = getHostname(url);
  if (hostname.includes("-pooler") || url.port === "6432") {
    throw new Error(
      "DATABASE_MIGRATION_URL must use a direct Postgres endpoint on port 5432, not a pooled endpoint."
    );
  }
};

const withMigrationTimeouts = (value: string) => {
  const url = new URL(value);
  url.searchParams.delete("pgbouncer");

  const options = [
    url.searchParams.get("options"),
    `-c lock_timeout=${LOCK_TIMEOUT}`,
    `-c statement_timeout=${STATEMENT_TIMEOUT}`,
  ]
    .filter(Boolean)
    .join(" ");

  url.searchParams.set("options", options);
  return url.toString();
};

export const getMigrationDatabaseUrl = () => {
  const migrationUrl = serverEnv.DATABASE_MIGRATION_URL?.trim();
  if (isPresent(migrationUrl)) {
    assertDirectMigrationDatabaseUrl(migrationUrl);
    return withMigrationTimeouts(migrationUrl);
  }

  const databaseUrl = serverEnv.DATABASE_URL?.trim();
  if (!isPresent(databaseUrl)) {
    throw new Error(
      "DATABASE_MIGRATION_URL or DATABASE_URL is required. Local scripts load ../../.env.local — add one of these vars there."
    );
  }

  const hostname = getHostname(new URL(databaseUrl));
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      "DATABASE_MIGRATION_URL is required when DATABASE_URL is not loopback PostgreSQL. Use a direct Postgres endpoint on port 5432 for migrations."
    );
  }

  return withMigrationTimeouts(databaseUrl);
};

export const assertMigrationExecutionAllowed = (
  value: string,
  environment: Record<string, string | undefined> = process.env
) => {
  const url = new URL(value);

  if (LOOPBACK_HOSTS.has(getHostname(url))) {
    return;
  }

  if (isExplicitLocalPlanetScaleUrl(url, environment) && url.port === "5432") {
    return;
  }

  const isGitHubActionsJob =
    environment.CI === "true" &&
    environment.GITHUB_ACTIONS === "true" &&
    environment.GITHUB_REPOSITORY === PRODUCTION_REPOSITORY;

  const isApprovedProductionMigrationJob =
    isGitHubActionsJob &&
    environment.QUIETER_ALLOW_REMOTE_MIGRATIONS === "production" &&
    environment.GITHUB_REF === productionMigrationTarget.ref &&
    (!productionMigrationTarget.protectedRef ||
      environment.GITHUB_REF_PROTECTED === "true");

  const isApprovedReviewMigrationJob =
    isGitHubActionsJob &&
    environment.QUIETER_ALLOW_REMOTE_MIGRATIONS === "review" &&
    environment.QUIETER_REVIEW_DEPLOYMENT === "true";

  if (!isApprovedProductionMigrationJob && !isApprovedReviewMigrationJob) {
    throw new Error(
      "Remote database migrations are restricted to approved GitHub Actions deployment jobs"
    );
  }
};
