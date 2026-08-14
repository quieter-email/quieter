import { existsSync, readFileSync } from "node:fs";

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

export const forbiddenLocalKeys = [
  "AI_MEMORY_SERVICE_TOKEN",
  "AI_MEMORY_SERVICE_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "CHAT_GENERATION_START_TOKEN",
  "CHAT_GENERATION_START_URL",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_DEFAULT_ACCOUNT_ID",
  "GMAIL_CREDENTIAL_ROTATION_TOKEN",
  "GMAIL_LIVE_SYNC_TOKEN_SECRET",
  "GMAIL_LIVE_SYNC_URL",
  "GMAIL_PUBSUB_PROCESS_TOKEN",
  "GMAIL_PUBSUB_PUSH_AUDIENCE",
  "GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT",
  "GMAIL_PUBSUB_QUEUE_URL",
  "GMAIL_PUBSUB_SUBSCRIPTION",
  "GMAIL_PUBSUB_TOPIC",
  "MAIL_BUCKET",
  "MAILBOX_ACTION_QUEUE_URL",
  "MAIL_RECEIPT_ROLE_ARN",
  "MAIL_RECEIPT_RULE_SET_NAME",
  "MAIL_RECEIPT_TOPIC_ARN",
  "QUIETER_MAIL_API_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ENDPOINT",
  "R2_SECRET_ACCESS_KEY",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN",
  "VITE_SENTRY_DSN",
] as const;

export const parseEnvFile = (path: string) => {
  const values = new Map<string, string>();

  for (const rawLine of readFileSync(path, "utf-8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "") {
      values.set(key, value);
    }
  }

  return values;
};

const getHostname = (value: string) =>
  new URL(value).hostname.replace(/^\[(?<host>.*)\]$/u, "$<host>");

const hasText = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const isPlanetScaleHostname = (hostname: string) =>
  hostname.endsWith(".pg.psdb.cloud") ||
  hostname.endsWith(".horizon.psdb.cloud");

const isAllowlistedPlanetScaleUrl = (
  key: "DATABASE_MIGRATION_URL" | "DATABASE_URL",
  value: string,
  configuredPlanetScaleHost: string | undefined
) => {
  const url = new URL(value);
  return (
    hasText(configuredPlanetScaleHost) &&
    isPlanetScaleHostname(configuredPlanetScaleHost) &&
    getHostname(value).toLowerCase() === configuredPlanetScaleHost &&
    url.pathname.slice(1) === "quieter_dev" &&
    url.searchParams.get("sslmode") === "verify-full" &&
    url.port === (key === "DATABASE_URL" ? "6432" : "5432")
  );
};

const collectForbiddenKeyErrors = (env: Map<string, string>) =>
  forbiddenLocalKeys.flatMap((key) =>
    env.has(key)
      ? [
          `${key} must not be present in .env.local. Keep provider secrets out of local.`,
        ]
      : []
  );

const validateDatabaseUrls = (
  env: Map<string, string>,
  configuredPlanetScaleHost: string | undefined
) => {
  const errors: string[] = [];

  for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
    const value = env.get(key);
    if (!hasText(value)) {
      continue;
    }

    try {
      const hostname = getHostname(value);
      if (
        loopbackHosts.has(hostname) ||
        isAllowlistedPlanetScaleUrl(key, value, configuredPlanetScaleHost)
      ) {
        continue;
      }
      errors.push(
        `${key} must target loopback PostgreSQL or the allowlisted PlanetScale quieter_dev database in .env.local.`
      );
    } catch {
      errors.push(`${key} is not a valid URL.`);
    }
  }

  if (
    hasText(configuredPlanetScaleHost) &&
    isPlanetScaleHostname(configuredPlanetScaleHost)
  ) {
    const migrationUrl = env.get("DATABASE_MIGRATION_URL");
    if (!hasText(migrationUrl)) {
      errors.push(
        "DATABASE_MIGRATION_URL is required for the allowlisted local PlanetScale database and must use direct port 5432."
      );
    }
  }

  return errors;
};

const validateAuthAndDeployment = (env: Map<string, string>) => {
  const errors: string[] = [];
  const authUrl = env.get("BETTER_AUTH_URL");

  if (hasText(authUrl)) {
    try {
      if (loopbackHosts.has(getHostname(authUrl))) {
        // ok
      } else {
        errors.push("BETTER_AUTH_URL must target localhost in .env.local.");
      }
    } catch {
      errors.push("BETTER_AUTH_URL is not a valid URL.");
    }
  }

  if (env.get("QUIETER_DEPLOYMENT_ENV") === "local") {
    // ok
  } else {
    errors.push("QUIETER_DEPLOYMENT_ENV=local is required in .env.local.");
  }

  if (env.has("POLAR_ACCESS_TOKEN") && env.get("POLAR_SANDBOX") !== "true") {
    errors.push(
      "POLAR_SANDBOX=true is required when local Polar credentials are configured."
    );
  }

  if (env.get("QUIETER_AUTH_MAIL_MODE") === "console") {
    // ok
  } else {
    errors.push("QUIETER_AUTH_MAIL_MODE=console is required in .env.local.");
  }

  return errors;
};

export const diagnoseLocalEnv = (env: Map<string, string>) => {
  const configuredPlanetScaleHost = env
    .get("QUIETER_LOCAL_PLANETSCALE_HOST")
    ?.trim()
    .toLowerCase();

  return [
    ...collectForbiddenKeyErrors(env),
    ...validateDatabaseUrls(env, configuredPlanetScaleHost),
    ...validateAuthAndDeployment(env),
  ];
};

export const assertLocalEnvFile = (path: string) => {
  if (existsSync(path)) {
    const errors = diagnoseLocalEnv(parseEnvFile(path));
    if (errors.length > 0) {
      throw new Error(
        `Local environment is not isolated:\n${errors.map((error) => `- ${error}`).join("\n")}`
      );
    }
    return;
  }

  throw new Error(
    ".env.local is missing. Copy .env.example or run the local environment setup."
  );
};
/* oxlint-disable node/no-sync -- this bootstrap check intentionally reads local files synchronously. */
