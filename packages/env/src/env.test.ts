import { describe, expect, test } from "vite-plus/test";

import { createWebClientEnv } from "./client";
import { createServerEnv } from "./server";
import { createSstConfigEnv } from "./sst";

describe("server environment", () => {
  test("normalizes defaults and boolean strings", () => {
    const env = createServerEnv({
      NODE_ENV: "test",
      POLAR_SANDBOX: "yes",
      QUIETER_AUTH_MAIL_SENDER: "",
      QUIETER_PREVIEW_PERSONAS_ENABLED: "true",
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.POLAR_SANDBOX).toBeTruthy();
    expect(env.QUIETER_PREVIEW_PERSONAS_ENABLED).toBeTruthy();
    expect({
      authMailMode: env.QUIETER_AUTH_MAIL_MODE,
      authMailSender: env.QUIETER_AUTH_MAIL_SENDER,
      deploymentEnv: env.QUIETER_DEPLOYMENT_ENV,
      gmailAutomation: env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED,
    }).toStrictEqual({
      authMailMode: "api",
      authMailSender: "auth@quieter.email",
      deploymentEnv: "local",
      gmailAutomation: undefined,
    });
  });

  test("normalizes the Gmail AI automation runtime switch", () => {
    const env = createServerEnv({
      NODE_ENV: "test",
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "on",
    });

    expect(env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED).toBeTruthy();
  });

  test("accepts an explicit deployment environment", () => {
    const env = createServerEnv({
      NODE_ENV: "production",
      QUIETER_DEPLOYMENT_ENV: "production",
    });

    expect(env.QUIETER_DEPLOYMENT_ENV).toBe("production");
  });

  test("rejects non-HTTP service URLs", () => {
    expect(() =>
      createServerEnv({
        CHAT_GENERATION_START_URL: "file:///tmp/chat",
        NODE_ENV: "test",
      })
    ).toThrow(/HTTP or HTTPS/u);
  });

  test("accepts WebSocket live-sync URLs", () => {
    const env = createServerEnv({
      GMAIL_LIVE_SYNC_URL: "wss://example.com/live",
      NODE_ENV: "test",
    });

    expect(env.GMAIL_LIVE_SYNC_URL).toBe("wss://example.com/live");
  });
});

describe("web client environment", () => {
  test("provides public defaults", () => {
    const env = createWebClientEnv({});

    expect(env.VITE_PUBLIC_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
    expect(env.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED).toBe("false");
  });

  test("accepts preview personas flag", () => {
    const env = createWebClientEnv({
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: "true",
    });

    expect(env.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED).toBe("true");
  });

  test("rejects non-HTTP public service URLs", () => {
    expect(() =>
      createWebClientEnv({ VITE_PUBLIC_POSTHOG_HOST: "ftp://example.com" })
    ).toThrow(/HTTP or HTTPS/u);
  });
});

describe("SST environment", () => {
  test("parses deployment config without application secrets", () => {
    const env = createSstConfigEnv(
      { production: false },
      { QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "on" }
    );

    expect(env.GMAIL_PUBSUB_ENABLED).toBeFalsy();
    expect(env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED).toBeTruthy();
  });

  test("requires non-secret service configuration in production", () => {
    expect(() => createSstConfigEnv({ production: true }, {})).toThrow(
      "Gmail Pub/Sub configuration is required in production"
    );
  });

  test("rejects partial Gmail Pub/Sub configuration", () => {
    expect(() =>
      createSstConfigEnv(
        { production: false },
        { GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail" }
      )
    ).toThrow("Gmail Pub/Sub configuration is incomplete");
  });

  test("accepts complete production service configuration", () => {
    const env = createSstConfigEnv(
      { production: true },
      {
        GMAIL_PUBSUB_PUSH_AUDIENCE: "https://example.com/gmail",
        GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
          "gmail@example.iam.gserviceaccount.com",
        GMAIL_PUBSUB_SUBSCRIPTION: "projects/example/subscriptions/gmail",
        GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
        POLAR_PRODUCT_MANAGED_ID: "managed-product",
        POLAR_PRODUCT_PRO_ID: "pro-product",
        R2_ACCOUNT_ID: "r2-account",
        R2_BUCKET: "r2-bucket",
      }
    );

    expect(env.GMAIL_PUBSUB_ENABLED).toBeTruthy();
  });
});

describe("local environment doctor", () => {
  test("accepts an isolated local env", async () => {
    const { diagnoseLocalEnv } = await import("./local-doctor");
    const errors = diagnoseLocalEnv(
      new Map([
        ["BETTER_AUTH_URL", "http://localhost:3000"],
        ["DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/quieter"],
        ["QUIETER_AUTH_MAIL_MODE", "console"],
        ["QUIETER_DEPLOYMENT_ENV", "local"],
      ])
    );

    expect(errors).toStrictEqual([]);
  });

  test("accepts the allowlisted PlanetScale development database", async () => {
    const { diagnoseLocalEnv } = await import("./local-doctor");
    const errors = diagnoseLocalEnv(
      new Map([
        ["BETTER_AUTH_URL", "http://localhost:3000"],
        [
          "DATABASE_MIGRATION_URL",
          "postgresql://migrator:password@eu-central-1.pg.psdb.cloud:5432/quieter_dev?sslmode=verify-full",
        ],
        [
          "DATABASE_URL",
          "postgresql://app:password@eu-central-1.pg.psdb.cloud:6432/quieter_dev?sslmode=verify-full",
        ],
        ["QUIETER_AUTH_MAIL_MODE", "console"],
        ["QUIETER_DEPLOYMENT_ENV", "local"],
        ["QUIETER_LOCAL_PLANETSCALE_HOST", "eu-central-1.pg.psdb.cloud"],
      ])
    );

    expect(errors).toStrictEqual([]);
  });

  test("rejects cloud secrets and non-local deployment", async () => {
    const { diagnoseLocalEnv } = await import("./local-doctor");
    const errors = diagnoseLocalEnv(
      new Map([
        ["GMAIL_LIVE_SYNC_URL", "wss://example.com"],
        ["QUIETER_AUTH_MAIL_MODE", "api"],
        ["QUIETER_DEPLOYMENT_ENV", "production"],
      ])
    );

    expect(errors).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining("GMAIL_LIVE_SYNC_URL"),
        expect.stringContaining("QUIETER_DEPLOYMENT_ENV=local"),
        expect.stringContaining("QUIETER_AUTH_MAIL_MODE=console"),
      ])
    );
  });
});
