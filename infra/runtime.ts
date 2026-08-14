import { createSstConfigEnv } from "@quieter/env/sst";

import { requireSecretResource } from "./secrets";
import { getEnvironmentValue, production, stage } from "./stage";
import type { SecretResources } from "./types";

export const cloudflareWorkerObservability = {
  enabled: true,
  logs: {
    enabled: true,
    headSamplingRate: 1,
    invocationLogs: true,
    persist: true,
  },
  traces: {
    enabled: true,
    headSamplingRate: 0.01,
    persist: true,
  },
} as const;

type SstEnvironment = ReturnType<typeof createSstConfigEnv>;

const createGmailPubSubEnvironment = (env: SstEnvironment) => ({
  GMAIL_PUBSUB_PUSH_AUDIENCE: env.GMAIL_PUBSUB_PUSH_AUDIENCE ?? "",
  GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
    env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT ?? "",
  GMAIL_PUBSUB_SUBSCRIPTION: env.GMAIL_PUBSUB_SUBSCRIPTION ?? "",
  GMAIL_PUBSUB_TOPIC: env.GMAIL_PUBSUB_TOPIC ?? "",
});

const createR2Environment = (
  env: SstEnvironment,
  secretResources: SecretResources
) => ({
  R2_ACCESS_KEY_ID: requireSecretResource(secretResources, "R2_ACCESS_KEY_ID")
    .value,
  R2_ACCOUNT_ID: env.R2_ACCOUNT_ID ?? "",
  R2_BUCKET: env.R2_BUCKET ?? "",
  R2_ENDPOINT: env.R2_ENDPOINT ?? "",
  R2_SECRET_ACCESS_KEY: requireSecretResource(
    secretResources,
    "R2_SECRET_ACCESS_KEY"
  ).value,
});

const createSentryEnvironment = (secretResources: SecretResources) => ({
  SENTRY_DSN: requireSecretResource(secretResources, "SENTRY_DSN").value,
  SENTRY_ENVIRONMENT: getEnvironmentValue("SENTRY_ENVIRONMENT", stage),
});

export const createDeploymentContext = (secretResources: SecretResources) => {
  const env = createSstConfigEnv({ production });
  const polarSandbox =
    env.POLAR_SANDBOX === undefined ? "" : String(env.POLAR_SANDBOX);
  const mailAutomationAiEnabled = String(
    env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED ?? production
  );

  return {
    aiMemoryServiceToken: requireSecretResource(
      secretResources,
      "AI_MEMORY_SERVICE_TOKEN"
    ).value,
    connectorTokenEncryptionKey: requireSecretResource(
      secretResources,
      "CONNECTOR_TOKEN_ENCRYPTION_KEY"
    ).value,
    databaseUrl: requireSecretResource(secretResources, "DATABASE_URL").value,
    env,
    gmailPubSubEnabled: env.GMAIL_PUBSUB_ENABLED,
    gmailPubSubEnvironment: createGmailPubSubEnvironment(env),
    gmailTokenEncryptionKey: requireSecretResource(
      secretResources,
      "GMAIL_TOKEN_ENCRYPTION_KEY"
    ).value,
    gmailTokenEncryptionKeyCurrent: requireSecretResource(
      secretResources,
      "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT"
    ).value,
    googleCalendarClientId: requireSecretResource(
      secretResources,
      "GOOGLE_CALENDAR_CLIENT_ID"
    ).value,
    googleCalendarClientSecret: requireSecretResource(
      secretResources,
      "GOOGLE_CALENDAR_CLIENT_SECRET"
    ).value,
    googleGmailClientId: requireSecretResource(
      secretResources,
      "GOOGLE_GMAIL_CLIENT_ID"
    ).value,
    googleGmailClientSecret: requireSecretResource(
      secretResources,
      "GOOGLE_GMAIL_CLIENT_SECRET"
    ).value,
    linearClientId: requireSecretResource(secretResources, "LINEAR_CLIENT_ID")
      .value,
    linearClientSecret: requireSecretResource(
      secretResources,
      "LINEAR_CLIENT_SECRET"
    ).value,
    mailAutomationAiEnabled,
    openRouterApiKey: requireSecretResource(
      secretResources,
      "OPENROUTER_API_KEY"
    ).value,
    polarAccessToken: requireSecretResource(
      secretResources,
      "POLAR_ACCESS_TOKEN"
    ).value,
    polarOrganizationId: env.POLAR_ORGANIZATION_ID ?? "",
    polarProductManagedId: env.POLAR_PRODUCT_MANAGED_ID ?? "",
    polarProductProId: env.POLAR_PRODUCT_PRO_ID ?? "",
    polarSandbox,
    r2Environment: createR2Environment(env, secretResources),
    sentryEnvironment: createSentryEnvironment(secretResources),
  };
};

export const requireWorkerUrl = (
  url: $util.Output<string | undefined>,
  resourceName: string
) =>
  url.apply((value) => {
    if (value === undefined || value === "") {
      throw new Error(`${resourceName} did not expose a URL`);
    }

    return value;
  });

export type DeploymentContext = ReturnType<typeof createDeploymentContext>;
