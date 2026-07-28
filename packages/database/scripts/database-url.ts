import { serverEnv } from "@quieter/env/server";

const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "5min";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PRODUCTION_REPOSITORY = "quieter-email/quieter";
const productionMigrationTarget = {
  protectedRef: true,
  ref: "refs/heads/main",
} as const;

const getHostname = (url: URL) => url.hostname.replace(/^\[(.*)\]$/, "$1");
const normalizeNeonHostname = (hostname: string) => hostname.replace("-pooler.", ".");

const isExplicitLocalNeonConfigured = (environment: Record<string, string | undefined>) => {
  const configuredHost = environment.QUIETER_LOCAL_NEON_HOST?.trim().toLowerCase();
  return (
    !!configuredHost &&
    configuredHost.endsWith(".neon.tech") &&
    environment.QUIETER_DEPLOYMENT_ENV === "local"
  );
};

const isExplicitLocalNeonUrl = (url: URL, environment: Record<string, string | undefined>) => {
  const configuredHost = environment.QUIETER_LOCAL_NEON_HOST?.trim().toLowerCase();
  if (!configuredHost || environment.QUIETER_DEPLOYMENT_ENV !== "local") {
    return false;
  }

  const hostname = normalizeNeonHostname(getHostname(url).toLowerCase());
  return (
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    configuredHost.endsWith(".neon.tech") &&
    hostname === normalizeNeonHostname(configuredHost)
  );
};

const assertDirectMigrationDatabaseUrl = (value: string) => {
  const hostname = getHostname(new URL(value));
  if (hostname.includes("-pooler")) {
    throw new Error(
      "DATABASE_MIGRATION_URL must use the direct Neon endpoint, not the pooled endpoint.",
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
  if (migrationUrl) {
    assertDirectMigrationDatabaseUrl(migrationUrl);
    return withMigrationTimeouts(migrationUrl);
  }

  const databaseUrl = serverEnv.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_MIGRATION_URL or DATABASE_URL is required. Local scripts load ../../.env.local — add one of these vars there.",
    );
  }

  const hostname = getHostname(new URL(databaseUrl));
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      "DATABASE_MIGRATION_URL is required when DATABASE_URL is not loopback PostgreSQL. Use the direct Neon endpoint for migrations.",
    );
  }

  return withMigrationTimeouts(databaseUrl);
};

export const assertLocalDatabaseUrl = (value: string, expectedDatabase?: string) => {
  const url = new URL(value);
  const database = url.pathname.slice(1);

  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(getHostname(url))
  ) {
    throw new Error("Destructive database commands are restricted to loopback PostgreSQL servers");
  }

  if (expectedDatabase && database !== expectedDatabase) {
    throw new Error(`Destructive database commands require the ${expectedDatabase} database`);
  }
};

export const assertLocalDevelopmentDatabaseUrls = (
  environment: Record<string, string | undefined> = process.env,
) => {
  if (isExplicitLocalNeonConfigured(environment)) {
    const migrationUrl = environment.DATABASE_MIGRATION_URL?.trim();
    if (!migrationUrl) {
      throw new Error(
        "DATABASE_MIGRATION_URL is required for the allowlisted local Neon branch and must use the direct endpoint.",
      );
    }
    assertDirectMigrationDatabaseUrl(migrationUrl);
  }

  for (const name of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
    const value = environment[name]?.trim();
    if (!value) {
      continue;
    }

    try {
      const url = new URL(value);
      if (!isExplicitLocalNeonUrl(url, environment)) {
        assertLocalDatabaseUrl(value);
      }
    } catch {
      throw new Error(
        `${name} must target loopback PostgreSQL or the explicitly allowlisted local Neon host.`,
      );
    }
  }
};

export const assertMigrationExecutionAllowed = (
  value: string,
  environment: Record<string, string | undefined> = process.env,
) => {
  const url = new URL(value);

  if (LOOPBACK_HOSTS.has(getHostname(url))) {
    return;
  }

  if (isExplicitLocalNeonUrl(url, environment)) {
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
    (!productionMigrationTarget.protectedRef || environment.GITHUB_REF_PROTECTED === "true");

  const isApprovedReviewMigrationJob =
    isGitHubActionsJob &&
    environment.QUIETER_ALLOW_REMOTE_MIGRATIONS === "review" &&
    environment.QUIETER_REVIEW_DEPLOYMENT === "true";

  if (!isApprovedProductionMigrationJob && !isApprovedReviewMigrationJob) {
    throw new Error(
      "Remote database migrations are restricted to approved GitHub Actions deployment jobs",
    );
  }
};
