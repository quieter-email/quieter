import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import {
  optionalBooleanString,
  optionalString,
  throwEnvironmentValidationError,
} from "./schema";
import type { RuntimeEnvironment } from "./schema";

const gmailPubSubVariableNames = [
  "GMAIL_PUBSUB_PUSH_AUDIENCE",
  "GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT",
  "GMAIL_PUBSUB_SUBSCRIPTION",
  "GMAIL_PUBSUB_TOPIC",
] as const;

const polarProductVariableNames = [
  "POLAR_PRODUCT_MANAGED_ID",
  "POLAR_PRODUCT_PRO_ID",
] as const;
const connectorVariableNames = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
] as const;
const linearConnectorVariableNames = [
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
] as const;
const r2VariableNames = [
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_SECRET_ACCESS_KEY",
] as const;

const isMissing = (value: string | undefined) =>
  value === undefined || value === "";

const assertCompleteOrEmpty = (
  label: string,
  missing: readonly string[],
  total: number
) => {
  if (missing.length > 0 && missing.length < total) {
    throw new Error(`${label} is incomplete: ${missing.join(", ")}`);
  }
};

const assertRequiredInProduction = (
  production: boolean,
  label: string,
  missing: readonly string[]
) => {
  if (production && missing.length > 0) {
    throw new Error(
      `${label} is required in production: ${missing.join(", ")}`
    );
  }
};

export const createSstEnv = (
  options: { production: boolean },
  runtimeEnv: RuntimeEnvironment = process.env
) => {
  const env = createEnv({
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      CONNECTOR_TOKEN_ENCRYPTION_KEY: runtimeEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY,
      DATABASE_URL: runtimeEnv.DATABASE_URL,
      DOMAIN_CONNECT_PRIVATE_KEY_B64: runtimeEnv.DOMAIN_CONNECT_PRIVATE_KEY_B64,
      GMAIL_PUBSUB_PUSH_AUDIENCE: runtimeEnv.GMAIL_PUBSUB_PUSH_AUDIENCE,
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
        runtimeEnv.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
      GMAIL_PUBSUB_SUBSCRIPTION: runtimeEnv.GMAIL_PUBSUB_SUBSCRIPTION,
      GMAIL_PUBSUB_TOPIC: runtimeEnv.GMAIL_PUBSUB_TOPIC,
      GMAIL_TOKEN_ENCRYPTION_KEY: runtimeEnv.GMAIL_TOKEN_ENCRYPTION_KEY,
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT:
        runtimeEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT,
      GOOGLE_CALENDAR_CLIENT_ID: runtimeEnv.GOOGLE_CALENDAR_CLIENT_ID,
      GOOGLE_CALENDAR_CLIENT_SECRET: runtimeEnv.GOOGLE_CALENDAR_CLIENT_SECRET,
      GOOGLE_GMAIL_CLIENT_ID: runtimeEnv.GOOGLE_GMAIL_CLIENT_ID,
      GOOGLE_GMAIL_CLIENT_SECRET: runtimeEnv.GOOGLE_GMAIL_CLIENT_SECRET,
      LINEAR_CLIENT_ID: runtimeEnv.LINEAR_CLIENT_ID,
      LINEAR_CLIENT_SECRET: runtimeEnv.LINEAR_CLIENT_SECRET,
      OPENROUTER_API_KEY: runtimeEnv.OPENROUTER_API_KEY,
      POLAR_ACCESS_TOKEN: runtimeEnv.POLAR_ACCESS_TOKEN,
      POLAR_ORGANIZATION_ID: runtimeEnv.POLAR_ORGANIZATION_ID,
      POLAR_PRODUCT_MANAGED_ID: runtimeEnv.POLAR_PRODUCT_MANAGED_ID,
      POLAR_PRODUCT_PRO_ID: runtimeEnv.POLAR_PRODUCT_PRO_ID,
      POLAR_SANDBOX: runtimeEnv.POLAR_SANDBOX,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED:
        runtimeEnv.QUIETER_GMAIL_AI_AUTOMATION_ENABLED,
      R2_ACCESS_KEY_ID: runtimeEnv.R2_ACCESS_KEY_ID,
      R2_ACCOUNT_ID: runtimeEnv.R2_ACCOUNT_ID,
      R2_BUCKET: runtimeEnv.R2_BUCKET,
      R2_ENDPOINT: runtimeEnv.R2_ENDPOINT,
      R2_SECRET_ACCESS_KEY: runtimeEnv.R2_SECRET_ACCESS_KEY,
    },
    server: {
      CONNECTOR_TOKEN_ENCRYPTION_KEY: optionalString,
      DATABASE_URL: z.string().trim().pipe(z.url()),
      DOMAIN_CONNECT_PRIVATE_KEY_B64: optionalString,
      GMAIL_PUBSUB_PUSH_AUDIENCE: optionalString,
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: z.email().optional(),
      GMAIL_PUBSUB_SUBSCRIPTION: optionalString,
      GMAIL_PUBSUB_TOPIC: optionalString,
      GMAIL_TOKEN_ENCRYPTION_KEY: z.string().trim().min(1),
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: optionalString,
      GOOGLE_CALENDAR_CLIENT_ID: optionalString,
      GOOGLE_CALENDAR_CLIENT_SECRET: optionalString,
      GOOGLE_GMAIL_CLIENT_ID: z.string().trim().min(1),
      GOOGLE_GMAIL_CLIENT_SECRET: z.string().trim().min(1),
      LINEAR_CLIENT_ID: optionalString,
      LINEAR_CLIENT_SECRET: optionalString,
      OPENROUTER_API_KEY: z.string().trim().min(1),
      POLAR_ACCESS_TOKEN: z.string().trim().min(1),
      POLAR_ORGANIZATION_ID: optionalString,
      POLAR_PRODUCT_MANAGED_ID: optionalString,
      POLAR_PRODUCT_PRO_ID: optionalString,
      POLAR_SANDBOX: optionalBooleanString,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: optionalBooleanString,
      R2_ACCESS_KEY_ID: optionalString,
      R2_ACCOUNT_ID: optionalString,
      R2_BUCKET: optionalString,
      R2_ENDPOINT: optionalString,
      R2_SECRET_ACCESS_KEY: optionalString,
    },
  });

  const missingGmailPubSubVariables = gmailPubSubVariableNames.filter((name) =>
    isMissing(env[name])
  );
  assertCompleteOrEmpty(
    "Gmail Pub/Sub configuration",
    missingGmailPubSubVariables,
    gmailPubSubVariableNames.length
  );
  assertRequiredInProduction(
    options.production,
    "Gmail Pub/Sub configuration",
    missingGmailPubSubVariables
  );

  if (options.production && isMissing(env.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT)) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT is required in production."
    );
  }

  const missingConnectorVariables = connectorVariableNames.filter((name) =>
    isMissing(env[name])
  );
  const missingLinearConnectorVariables = linearConnectorVariableNames.filter(
    (name) => isMissing(env[name])
  );
  const hasCompleteConnectorProvider =
    missingConnectorVariables.length === 0 ||
    missingLinearConnectorVariables.length === 0;

  assertCompleteOrEmpty(
    "Connector configuration",
    missingConnectorVariables,
    connectorVariableNames.length
  );
  assertRequiredInProduction(
    options.production,
    "Connector configuration",
    missingConnectorVariables
  );
  assertCompleteOrEmpty(
    "Linear connector configuration",
    missingLinearConnectorVariables,
    linearConnectorVariableNames.length
  );
  assertRequiredInProduction(
    options.production,
    "Linear connector configuration",
    missingLinearConnectorVariables
  );

  if (
    (options.production || hasCompleteConnectorProvider) &&
    isMissing(env.CONNECTOR_TOKEN_ENCRYPTION_KEY)
  ) {
    throw new Error(
      "CONNECTOR_TOKEN_ENCRYPTION_KEY is required when connectors are configured."
    );
  }

  assertRequiredInProduction(
    options.production,
    "Polar product configuration",
    polarProductVariableNames.filter((name) => isMissing(env[name]))
  );
  assertRequiredInProduction(
    options.production,
    "R2 raw mail storage configuration",
    r2VariableNames.filter((name) => isMissing(env[name]))
  );

  return {
    ...env,
    GMAIL_PUBSUB_ENABLED: missingGmailPubSubVariables.length === 0,
  };
};
