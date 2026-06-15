import { describe, expect, spyOn, test } from "bun:test";
import { createWebClientEnv } from "./client";
import { createDeploymentEnv } from "./deployment";
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

describe("server environment", () => {
  test("normalizes defaults and boolean strings", () => {
    const env = createServerEnv({
      NODE_ENV: "test",
      POLAR_SANDBOX: "yes",
      QUIETER_AUTH_MAIL_SENDER: "",
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.POLAR_SANDBOX).toBe(true);
    expect(env.QUIETER_AUTH_MAIL_SENDER).toBe("auth@quieter.email");
  });
});

describe("web client environment", () => {
  test("provides public defaults", () => {
    const env = createWebClientEnv({});

    expect(env.VITE_PUBLIC_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
  });
});

describe("SST environment", () => {
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
});

describe("deployment environment", () => {
  test("requires all Vercel deployment inputs", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(() => createDeploymentEnv({})).toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });
});
