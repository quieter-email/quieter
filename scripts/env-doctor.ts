import { existsSync, readFileSync } from "node:fs";

const localEnvPath = ".env.local";
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const forbiddenLocalKeys = [
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
  "GOOGLE_API_KEY",
  "MAIL_BUCKET",
  "MAIL_RECEIPT_ROLE_ARN",
  "MAIL_RECEIPT_RULE_SET_NAME",
  "MAIL_RECEIPT_TOPIC_ARN",
  "OPENROUTER_API_KEY",
  "POLAR_ACCESS_TOKEN",
  "POLAR_METER_CREDIT_USAGE_ID",
  "POLAR_ORGANIZATION_ID",
  "POLAR_PRODUCT_MANAGED_ID",
  "POLAR_PRODUCT_PRO_ID",
  "POLAR_WEBHOOK_SECRET",
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

const parseEnvFile = (path: string) => {
  const values = new Map<string, string>();

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) values.set(key, value);
  }

  return values;
};

const getHostname = (value: string) => new URL(value).hostname.replace(/^\[(.*)\]$/, "$1");

if (!existsSync(localEnvPath)) {
  throw new Error(".env.local is missing. Copy .env.example or run the local environment setup.");
}

const env = parseEnvFile(localEnvPath);
const errors: string[] = [];

for (const key of forbiddenLocalKeys) {
  if (env.has(key)) {
    errors.push(`${key} must not be present in .env.local. Keep provider secrets out of local.`);
  }
}

for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
  const value = env.get(key);
  if (!value) continue;

  try {
    if (!loopbackHosts.has(getHostname(value))) {
      errors.push(`${key} must target loopback PostgreSQL in .env.local.`);
    }
  } catch {
    errors.push(`${key} is not a valid URL.`);
  }
}

const authUrl = env.get("BETTER_AUTH_URL");
if (authUrl) {
  try {
    if (!loopbackHosts.has(getHostname(authUrl))) {
      errors.push("BETTER_AUTH_URL must target localhost in .env.local.");
    }
  } catch {
    errors.push("BETTER_AUTH_URL is not a valid URL.");
  }
}

if (env.get("QUIETER_AUTH_MAIL_MODE") !== "console") {
  errors.push("QUIETER_AUTH_MAIL_MODE=console is required in .env.local.");
}

if (errors.length > 0) {
  throw new Error(
    `Local environment is not isolated:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
}

console.log("Local environment is isolated from production-shaped service keys.");
