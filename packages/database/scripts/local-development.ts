export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const LOCAL_PLANETSCALE_DATABASE = "quieter_dev";

export const getHostname = (url: URL) =>
  url.hostname.replace(/^\[(?<host>.*)\]$/u, "$<host>");

export const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const isPlanetScaleHostname = (hostname: string) =>
  hostname.endsWith(".pg.psdb.cloud") ||
  hostname.endsWith(".horizon.psdb.cloud");

const getConfiguredPlanetScaleHost = (
  environment: Record<string, string | undefined>
) => environment.QUIETER_LOCAL_PLANETSCALE_HOST?.trim().toLowerCase();

const isExplicitLocalPlanetScaleConfigured = (
  environment: Record<string, string | undefined>
) => {
  const configuredHost = getConfiguredPlanetScaleHost(environment);
  return (
    isPresent(configuredHost) &&
    isPlanetScaleHostname(configuredHost) &&
    environment.QUIETER_DEPLOYMENT_ENV === "local"
  );
};

export const isExplicitLocalPlanetScaleUrl = (
  url: URL,
  environment: Record<string, string | undefined>
) => {
  const configuredHost = getConfiguredPlanetScaleHost(environment);
  return (
    isPresent(configuredHost) &&
    environment.QUIETER_DEPLOYMENT_ENV === "local" &&
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    isPlanetScaleHostname(configuredHost) &&
    getHostname(url).toLowerCase() === configuredHost &&
    url.pathname.slice(1) === LOCAL_PLANETSCALE_DATABASE &&
    url.searchParams.get("sslmode") === "verify-full"
  );
};

const assertPlanetScaleConnectionType = (
  name: "DATABASE_MIGRATION_URL" | "DATABASE_URL",
  url: URL
) => {
  const expectedPort = name === "DATABASE_URL" ? "6432" : "5432";
  if (url.port !== expectedPort) {
    throw new Error(
      `${name} must use PlanetScale port ${expectedPort} for local development.`
    );
  }
};

export const assertLocalDatabaseUrl = (
  value: string,
  expectedDatabase?: string
) => {
  const url = new URL(value);
  const database = url.pathname.slice(1);

  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(getHostname(url))
  ) {
    throw new Error(
      "Destructive database commands are restricted to loopback PostgreSQL servers"
    );
  }

  if (isPresent(expectedDatabase) && database !== expectedDatabase) {
    throw new Error(
      `Destructive database commands require the ${expectedDatabase} database`
    );
  }
};

export const assertLocalDevelopmentDatabaseUrls = (
  environment: Record<string, string | undefined> = process.env
) => {
  if (isExplicitLocalPlanetScaleConfigured(environment)) {
    const migrationUrl = environment.DATABASE_MIGRATION_URL?.trim();
    if (!isPresent(migrationUrl)) {
      throw new Error(
        "DATABASE_MIGRATION_URL is required for the allowlisted local PlanetScale database and must use direct port 5432."
      );
    }
  }

  for (const name of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
    const value = environment[name]?.trim();
    if (!isPresent(value)) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid URL.`);
    }

    if (isExplicitLocalPlanetScaleUrl(url, environment)) {
      assertPlanetScaleConnectionType(name, url);
      continue;
    }

    try {
      assertLocalDatabaseUrl(value);
    } catch {
      throw new Error(
        `${name} must target loopback PostgreSQL or the explicitly allowlisted PlanetScale quieter_dev database.`
      );
    }
  }
};
