import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { createDeploymentContext } from "./runtime";

vi.mock(import("./stage"), () => ({
  appOrigin: "https://quieter.email",
  deploymentEnvironment: "production" as const,
  getEnvironmentValue: (_name: string, fallback: string) => fallback,
  production: true,
  stage: "production",
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- This test supplies inert values instead of Pulumi outputs.
vi.mock("./secrets", () => ({
  requireSecretResource: () => ({ value: "test-secret" }),
}));

describe("production billing environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("pins every billing runtime to production despite a sandbox override", () => {
    vi.stubEnv("POLAR_SANDBOX", "true");
    vi.stubEnv("GMAIL_PUBSUB_PUSH_AUDIENCE", "https://example.invalid/pubsub");
    vi.stubEnv("GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT", "push@example.invalid");
    vi.stubEnv("GMAIL_PUBSUB_SUBSCRIPTION", "projects/test/subscriptions/test");
    vi.stubEnv("GMAIL_PUBSUB_TOPIC", "projects/test/topics/test");
    vi.stubEnv("POLAR_PRODUCT_MANAGED_ID", "managed");
    vi.stubEnv("POLAR_PRODUCT_PRO_ID", "pro");
    vi.stubEnv("R2_ACCOUNT_ID", "test-account");
    vi.stubEnv("R2_BUCKET", "test-bucket");
    vi.stubEnv("R2_ENDPOINT", "https://example.invalid");
    const { billingEnvironment } = createDeploymentContext({});
    expect(billingEnvironment).toMatchObject({
      POLAR_SANDBOX: "false",
      QUIETER_DEPLOYMENT_ENV: "production",
    });
  });
});
