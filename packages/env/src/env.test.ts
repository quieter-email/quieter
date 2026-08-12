import { describe, expect, test } from "vite-plus/test";

import { createWebClientEnv } from "./client";
import { createServerEnv } from "./server";
import { createSstEnv } from "./sst";

const requiredSstEnvironment = {
  DATABASE_URL: "postgresql://user:password@example.com/database",
  GMAIL_TOKEN_ENCRYPTION_KEY: "gmail-encryption-secret",
  GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: "current-gmail-encryption-secret",
  GOOGLE_GMAIL_CLIENT_ID: "gmail-client-id",
  GOOGLE_GMAIL_CLIENT_SECRET: "gmail-client-secret",
  OPENROUTER_API_KEY: "openrouter-key",
  POLAR_ACCESS_TOKEN: "polar-token",
};

const completeProductionSstEnvironment = {
  ...requiredSstEnvironment,
  CONNECTOR_TOKEN_ENCRYPTION_KEY: "connector-encryption-secret",
  GMAIL_PUBSUB_PUSH_AUDIENCE: "https://example.com/gmail",
  GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: "gmail@example.iam.gserviceaccount.com",
  GMAIL_PUBSUB_SUBSCRIPTION: "projects/example/subscriptions/gmail",
  GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
  GOOGLE_CALENDAR_CLIENT_ID: "calendar-client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-client-secret",
  LINEAR_CLIENT_ID: "linear-client-id",
  LINEAR_CLIENT_SECRET: "linear-client-secret",
  POLAR_PRODUCT_MANAGED_ID: "managed-product",
  POLAR_PRODUCT_PRO_ID: "pro-product",
  R2_ACCESS_KEY_ID: "r2-access-key",
  R2_ACCOUNT_ID: "r2-account",
  R2_BUCKET: "r2-bucket",
  R2_SECRET_ACCESS_KEY: "r2-secret",
};

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
    expect(env.VITE_QUIETER_DEPLOYMENT_ENV).toBe("production");
    expect(env.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED).toBe("false");
  });

  test("accepts the Review deployment environment", () => {
    const env = createWebClientEnv({ VITE_QUIETER_DEPLOYMENT_ENV: "preview" });

    expect(env.VITE_QUIETER_DEPLOYMENT_ENV).toBe("preview");
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
  test("normalizes the Gmail AI automation runtime switch", () => {
    const env = createSstEnv(
      { production: false },
      { ...requiredSstEnvironment, QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "on" }
    );

    expect(env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED).toBeTruthy();
  });

  test("allows Pub/Sub to be disabled outside production", () => {
    const env = createSstEnv({ production: false }, requiredSstEnvironment);

    expect(env.GMAIL_PUBSUB_ENABLED).toBeFalsy();
  });

  test("rejects partial Pub/Sub configuration", () => {
    expect(() =>
      createSstEnv(
        { production: false },
        {
          ...requiredSstEnvironment,
          GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
        }
      )
    ).toThrow("Gmail Pub/Sub configuration is incomplete");
  });

  test("requires Pub/Sub in production", () => {
    expect(() =>
      createSstEnv({ production: true }, requiredSstEnvironment)
    ).toThrow("Gmail Pub/Sub configuration is required in production");
  });

  test("requires the current Gmail credential key in production", () => {
    const { GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: _, ...environment } =
      requiredSstEnvironment;

    expect(() =>
      createSstEnv(
        { production: true },
        {
          ...environment,
          GMAIL_PUBSUB_PUSH_AUDIENCE: "https://example.com/gmail",
          GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
            "gmail@example.iam.gserviceaccount.com",
          GMAIL_PUBSUB_SUBSCRIPTION: "projects/example/subscriptions/gmail",
          GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
        }
      )
    ).toThrow("GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT is required in production");
  });

  test("rejects partial connector configuration", () => {
    expect(() =>
      createSstEnv(
        { production: false },
        {
          ...requiredSstEnvironment,
          GOOGLE_CALENDAR_CLIENT_ID: "calendar-client-id",
        }
      )
    ).toThrow("Connector configuration is incomplete");
  });

  test("rejects partial Linear connector configuration", () => {
    expect(() =>
      createSstEnv(
        { production: false },
        {
          ...requiredSstEnvironment,
          CONNECTOR_TOKEN_ENCRYPTION_KEY: "connector-encryption-secret",
          GOOGLE_CALENDAR_CLIENT_ID: "calendar-client-id",
          GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-client-secret",
          LINEAR_CLIENT_ID: "linear-client-id",
        }
      )
    ).toThrow("Linear connector configuration is incomplete");
  });

  test("requires connector configuration in production", () => {
    const {
      CONNECTOR_TOKEN_ENCRYPTION_KEY: _key,
      GOOGLE_CALENDAR_CLIENT_ID: _id,
      GOOGLE_CALENDAR_CLIENT_SECRET: _secret,
      ...environment
    } = completeProductionSstEnvironment;

    expect(() => createSstEnv({ production: true }, environment)).toThrow(
      "Connector configuration is required in production"
    );
  });

  test("requires Linear connector configuration in production", () => {
    const {
      LINEAR_CLIENT_ID: _id,
      LINEAR_CLIENT_SECRET: _secret,
      ...environment
    } = completeProductionSstEnvironment;

    expect(() => createSstEnv({ production: true }, environment)).toThrow(
      "Linear connector configuration is required in production"
    );
  });

  test("requires Polar product configuration in production", () => {
    const {
      POLAR_PRODUCT_MANAGED_ID: _managed,
      POLAR_PRODUCT_PRO_ID: _pro,
      ...environment
    } = completeProductionSstEnvironment;

    expect(() => createSstEnv({ production: true }, environment)).toThrow(
      "Polar product configuration is required in production"
    );
  });

  test("allows production without Domain Connect signing", () => {
    const env = createSstEnv(
      { production: true },
      completeProductionSstEnvironment
    );

    expect(env.DOMAIN_CONNECT_PRIVATE_KEY_B64).toBeUndefined();
  });

  test("accepts optional Domain Connect signing when present", () => {
    const env = createSstEnv(
      { production: true },
      {
        ...completeProductionSstEnvironment,
        DOMAIN_CONNECT_PRIVATE_KEY_B64: "encoded-private-key",
      }
    );

    expect(env.DOMAIN_CONNECT_PRIVATE_KEY_B64).toBe("encoded-private-key");
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
