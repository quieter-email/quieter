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
  DOMAIN_CONNECT_PRIVATE_KEY_B64: "encoded-private-key",
  GOOGLE_CALENDAR_CLIENT_ID: "calendar-client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-client-secret",
  LINEAR_CLIENT_ID: "linear-client-id",
  LINEAR_CLIENT_SECRET: "linear-client-secret",
  GMAIL_PUBSUB_PUSH_AUDIENCE: "https://example.com/gmail",
  GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: "gmail@example.iam.gserviceaccount.com",
  GMAIL_PUBSUB_SUBSCRIPTION: "projects/example/subscriptions/gmail",
  GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
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
      QUIETER_PREVIEW_PERSONAS_ENABLED: "true",
      QUIETER_AUTH_MAIL_SENDER: "",
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.POLAR_SANDBOX).toBe(true);
    expect(env.QUIETER_PREVIEW_PERSONAS_ENABLED).toBe(true);
    expect(env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED).toBeUndefined();
    expect(env.QUIETER_DEPLOYMENT_ENV).toBe("local");
    expect(env.QUIETER_AUTH_MAIL_MODE).toBe("api");
    expect(env.QUIETER_AUTH_MAIL_SENDER).toBe("auth@quieter.email");
  });

  test("normalizes the Gmail AI automation runtime switch", () => {
    const env = createServerEnv({
      NODE_ENV: "test",
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "on",
    });

    expect(env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED).toBe(true);
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
      }),
    ).toThrow();
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
    const env = createWebClientEnv({ VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: "true" });

    expect(env.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED).toBe("true");
  });

  test("rejects non-HTTP public service URLs", () => {
    expect(() => createWebClientEnv({ VITE_PUBLIC_POSTHOG_HOST: "ftp://example.com" })).toThrow();
  });
});

describe("SST environment", () => {
  test("normalizes the Gmail AI automation runtime switch", () => {
    const env = createSstEnv(
      { production: false },
      { ...requiredSstEnvironment, QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "on" },
    );

    expect(env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED).toBe(true);
  });

  test("allows Pub/Sub to be disabled outside production", () => {
    const env = createSstEnv({ production: false }, requiredSstEnvironment);

    expect(env.GMAIL_PUBSUB_ENABLED).toBe(false);
  });

  test("rejects partial Pub/Sub configuration", () => {
    expect(() =>
      createSstEnv(
        { production: false },
        {
          ...requiredSstEnvironment,
          GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
        },
      ),
    ).toThrow("Gmail Pub/Sub configuration is incomplete");
  });

  test("requires Pub/Sub in production", () => {
    expect(() => createSstEnv({ production: true }, requiredSstEnvironment)).toThrow(
      "Gmail Pub/Sub configuration is required in production",
    );
  });

  test("requires the current Gmail credential key in production", () => {
    const { GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: _, ...environment } = requiredSstEnvironment;

    expect(() =>
      createSstEnv(
        { production: true },
        {
          ...environment,
          GMAIL_PUBSUB_PUSH_AUDIENCE: "https://example.com/gmail",
          GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: "gmail@example.iam.gserviceaccount.com",
          GMAIL_PUBSUB_SUBSCRIPTION: "projects/example/subscriptions/gmail",
          GMAIL_PUBSUB_TOPIC: "projects/example/topics/gmail",
        },
      ),
    ).toThrow("GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT is required in production");
  });

  test("rejects partial connector configuration", () => {
    expect(() =>
      createSstEnv(
        { production: false },
        {
          ...requiredSstEnvironment,
          GOOGLE_CALENDAR_CLIENT_ID: "calendar-client-id",
        },
      ),
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
        },
      ),
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
      "Connector configuration is required in production",
    );
  });

  test("requires Linear connector configuration in production", () => {
    const {
      LINEAR_CLIENT_ID: _id,
      LINEAR_CLIENT_SECRET: _secret,
      ...environment
    } = completeProductionSstEnvironment;

    expect(() => createSstEnv({ production: true }, environment)).toThrow(
      "Linear connector configuration is required in production",
    );
  });

  test("requires Polar product configuration in production", () => {
    const {
      POLAR_PRODUCT_MANAGED_ID: _managed,
      POLAR_PRODUCT_PRO_ID: _pro,
      ...environment
    } = completeProductionSstEnvironment;

    expect(() => createSstEnv({ production: true }, environment)).toThrow(
      "Polar product configuration is required in production",
    );
  });

  test("requires Domain Connect signing in production", () => {
    const { DOMAIN_CONNECT_PRIVATE_KEY_B64: _, ...environment } = completeProductionSstEnvironment;

    expect(() => createSstEnv({ production: true }, environment)).toThrow(
      "DOMAIN_CONNECT_PRIVATE_KEY_B64 is required in production",
    );
  });
});
