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

const r2VariableNames = ["R2_ACCOUNT_ID", "R2_BUCKET"] as const;

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

/**
 * Parses deployment configuration that is intentionally not stored in SST
 * Secret. Credentials and tokens are declared and consumed as sst.Secret
 * resources under infra/.
 */
export const createSstConfigEnv = (
  options: { production: boolean },
  runtimeEnv: RuntimeEnvironment = process.env
) => {
  const env = createEnv({
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      GMAIL_BODY_STORAGE_ENABLED: runtimeEnv.GMAIL_BODY_STORAGE_ENABLED,
      GMAIL_PUBSUB_PUSH_AUDIENCE: runtimeEnv.GMAIL_PUBSUB_PUSH_AUDIENCE,
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
        runtimeEnv.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
      GMAIL_PUBSUB_SUBSCRIPTION: runtimeEnv.GMAIL_PUBSUB_SUBSCRIPTION,
      GMAIL_PUBSUB_TOPIC: runtimeEnv.GMAIL_PUBSUB_TOPIC,
      POLAR_ORGANIZATION_ID: runtimeEnv.POLAR_ORGANIZATION_ID,
      POLAR_PRODUCT_MANAGED_ID: runtimeEnv.POLAR_PRODUCT_MANAGED_ID,
      POLAR_PRODUCT_PRO_ID: runtimeEnv.POLAR_PRODUCT_PRO_ID,
      POLAR_SANDBOX: runtimeEnv.POLAR_SANDBOX,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED:
        runtimeEnv.QUIETER_GMAIL_AI_AUTOMATION_ENABLED,
      QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE:
        runtimeEnv.QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE,
      QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE:
        runtimeEnv.QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE,
      QUIETER_GMAIL_EVENTS_ENABLED: runtimeEnv.QUIETER_GMAIL_EVENTS_ENABLED,
      QUIETER_MAIL_EVENT_RELAY_ENABLED:
        runtimeEnv.QUIETER_MAIL_EVENT_RELAY_ENABLED,
      QUIETER_MAIL_EVENT_RELAY_SHARDED:
        runtimeEnv.QUIETER_MAIL_EVENT_RELAY_SHARDED,
      QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED:
        runtimeEnv.QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED,
      R2_ACCOUNT_ID: runtimeEnv.R2_ACCOUNT_ID,
      R2_BUCKET: runtimeEnv.R2_BUCKET,
      R2_ENDPOINT: runtimeEnv.R2_ENDPOINT,
    },
    server: {
      GMAIL_BODY_STORAGE_ENABLED: optionalBooleanString,
      GMAIL_PUBSUB_PUSH_AUDIENCE: optionalString,
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: z.email().optional(),
      GMAIL_PUBSUB_SUBSCRIPTION: optionalString,
      GMAIL_PUBSUB_TOPIC: optionalString,
      POLAR_ORGANIZATION_ID: optionalString,
      POLAR_PRODUCT_MANAGED_ID: optionalString,
      POLAR_PRODUCT_PRO_ID: optionalString,
      POLAR_SANDBOX: optionalBooleanString,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: optionalBooleanString,
      QUIETER_GMAIL_BACKGROUND_AI_REQUESTS_PER_MINUTE: z.coerce
        .number()
        .int()
        .min(60)
        .max(1_000_000)
        .optional(),
      QUIETER_GMAIL_BACKGROUND_QUOTA_UNITS_PER_MINUTE: z.coerce
        .number()
        .int()
        .min(15_000)
        .max(100_000_000)
        .default(600_000),
      QUIETER_GMAIL_EVENTS_ENABLED: optionalBooleanString,
      QUIETER_MAIL_EVENT_RELAY_ENABLED: optionalBooleanString,
      QUIETER_MAIL_EVENT_RELAY_SHARDED: optionalBooleanString,
      QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED: optionalBooleanString,
      R2_ACCOUNT_ID: optionalString,
      R2_BUCKET: optionalString,
      R2_ENDPOINT: optionalString,
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

export const createSstCommandEnv = (
  runtimeEnv: RuntimeEnvironment = process.env
) =>
  createEnv({
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      QUIETER_BUILD_ID: runtimeEnv.QUIETER_BUILD_ID,
      SST_STAGE: runtimeEnv.SST_STAGE,
    },
    server: {
      QUIETER_BUILD_ID: z.string().optional(),
      SST_STAGE: z.string().optional(),
    },
  });
