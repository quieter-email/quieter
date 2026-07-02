import { serverEnv } from "@quieter/env/server";

const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "5min";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PRODUCTION_REPOSITORY = "quieter-email/quieter";
const remoteMigrationTargets = {
  production: {
    protectedRef: true,
    ref: "refs/heads/main",
  },
  staging: {
    protectedRef: false,
    ref: "refs/heads/staging",
  },
} as const;

const getHostname = (url: URL) => url.hostname.replace(/^\[(.*)\]$/, "$1");

const toDirectPostgresUrl = (value: string) => {
  const url = new URL(value);

  if (url.hostname.includes("-pooler")) {
    url.hostname = url.hostname.replace("-pooler", "");
  }

  url.searchParams.delete("pgbouncer");

  return url;
};

export const getMigrationDatabaseUrl = () => {
  const value = serverEnv.DATABASE_MIGRATION_URL ?? serverEnv.DATABASE_URL;

  if (!value) {
    throw new Error(
      "DATABASE_MIGRATION_URL or DATABASE_URL is required. Local scripts load ../../.env.local — add one of these vars there.",
    );
  }

  const url = toDirectPostgresUrl(value);
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
  for (const name of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
    const value = environment[name]?.trim();
    if (!value) {
      continue;
    }

    try {
      assertLocalDatabaseUrl(value);
    } catch {
      throw new Error(
        `${name} must target local PostgreSQL during development. Developers must never receive production database credentials.`,
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

  const target =
    environment.QUIETER_ALLOW_REMOTE_MIGRATIONS === "production" ||
    environment.QUIETER_ALLOW_REMOTE_MIGRATIONS === "staging"
      ? remoteMigrationTargets[environment.QUIETER_ALLOW_REMOTE_MIGRATIONS]
      : null;
  const isApprovedRemoteMigrationJob =
    target !== null &&
    environment.CI === "true" &&
    environment.GITHUB_ACTIONS === "true" &&
    environment.GITHUB_REF === target.ref &&
    (!target.protectedRef || environment.GITHUB_REF_PROTECTED === "true") &&
    environment.GITHUB_REPOSITORY === PRODUCTION_REPOSITORY;

  if (!isApprovedRemoteMigrationJob) {
    throw new Error(
      "Remote database migrations are restricted to approved GitHub Actions deployment jobs",
    );
  }
};
