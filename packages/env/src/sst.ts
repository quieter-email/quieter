import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { optionalBooleanString, optionalString, type RuntimeEnvironment } from "./schema";

const gmailPubSubVariableNames = [
  "GMAIL_PUBSUB_PUSH_AUDIENCE",
  "GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT",
  "GMAIL_PUBSUB_SUBSCRIPTION",
  "GMAIL_PUBSUB_TOPIC",
] as const;

const polarProductVariableNames = [
  "POLAR_PRODUCT_PERSONAL_ID",
  "POLAR_PRODUCT_TEAM_AI_ID",
  "POLAR_PRODUCT_TEAM_ID",
] as const;

export const createSstEnv = (
  options: { production: boolean },
  runtimeEnv: RuntimeEnvironment = process.env,
) => {
  const env = createEnv({
    emptyStringAsUndefined: true,
    runtimeEnvStrict: {
      DATABASE_URL: runtimeEnv.DATABASE_URL,
      GMAIL_PUBSUB_PUSH_AUDIENCE: runtimeEnv.GMAIL_PUBSUB_PUSH_AUDIENCE,
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: runtimeEnv.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
      GMAIL_PUBSUB_SUBSCRIPTION: runtimeEnv.GMAIL_PUBSUB_SUBSCRIPTION,
      GMAIL_PUBSUB_TOPIC: runtimeEnv.GMAIL_PUBSUB_TOPIC,
      GMAIL_TOKEN_ENCRYPTION_KEY: runtimeEnv.GMAIL_TOKEN_ENCRYPTION_KEY,
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: runtimeEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT,
      GOOGLE_GMAIL_CLIENT_ID: runtimeEnv.GOOGLE_GMAIL_CLIENT_ID,
      GOOGLE_GMAIL_CLIENT_SECRET: runtimeEnv.GOOGLE_GMAIL_CLIENT_SECRET,
      OPENROUTER_API_KEY: runtimeEnv.OPENROUTER_API_KEY,
      POLAR_ACCESS_TOKEN: runtimeEnv.POLAR_ACCESS_TOKEN,
      POLAR_METER_CREDIT_USAGE_ID: runtimeEnv.POLAR_METER_CREDIT_USAGE_ID,
      POLAR_ORGANIZATION_ID: runtimeEnv.POLAR_ORGANIZATION_ID,
      POLAR_PRODUCT_PERSONAL_ID: runtimeEnv.POLAR_PRODUCT_PERSONAL_ID,
      POLAR_PRODUCT_TEAM_AI_ID: runtimeEnv.POLAR_PRODUCT_TEAM_AI_ID,
      POLAR_PRODUCT_TEAM_ID: runtimeEnv.POLAR_PRODUCT_TEAM_ID,
      POLAR_SANDBOX: runtimeEnv.POLAR_SANDBOX,
    },
    server: {
      DATABASE_URL: z.string().trim().url(),
      GMAIL_PUBSUB_PUSH_AUDIENCE: optionalString,
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: z.string().trim().email().optional(),
      GMAIL_PUBSUB_SUBSCRIPTION: optionalString,
      GMAIL_PUBSUB_TOPIC: optionalString,
      GMAIL_TOKEN_ENCRYPTION_KEY: z.string().trim().min(1),
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: optionalString,
      GOOGLE_GMAIL_CLIENT_ID: z.string().trim().min(1),
      GOOGLE_GMAIL_CLIENT_SECRET: z.string().trim().min(1),
      OPENROUTER_API_KEY: z.string().trim().min(1),
      POLAR_ACCESS_TOKEN: z.string().trim().min(1),
      POLAR_METER_CREDIT_USAGE_ID: optionalString,
      POLAR_ORGANIZATION_ID: optionalString,
      POLAR_PRODUCT_PERSONAL_ID: optionalString,
      POLAR_PRODUCT_TEAM_AI_ID: optionalString,
      POLAR_PRODUCT_TEAM_ID: optionalString,
      POLAR_SANDBOX: optionalBooleanString,
    },
  });
  const missingGmailPubSubVariables = gmailPubSubVariableNames.filter((name) => !env[name]);

  if (
    missingGmailPubSubVariables.length > 0 &&
    missingGmailPubSubVariables.length < gmailPubSubVariableNames.length
  ) {
    throw new Error(
      `Gmail Pub/Sub configuration is incomplete: ${missingGmailPubSubVariables.join(", ")}`,
    );
  }
  if (options.production && missingGmailPubSubVariables.length > 0) {
    throw new Error(
      `Gmail Pub/Sub configuration is required in production: ${missingGmailPubSubVariables.join(", ")}`,
    );
  }
  if (options.production && !env.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT is required in production.");
  }

  const missingPolarProductVariables = polarProductVariableNames.filter((name) => !env[name]);
  if (options.production && missingPolarProductVariables.length > 0) {
    throw new Error(
      `Polar product configuration is required in production: ${missingPolarProductVariables.join(", ")}`,
    );
  }

  return {
    ...env,
    GMAIL_PUBSUB_ENABLED: missingGmailPubSubVariables.length === 0,
  };
};
