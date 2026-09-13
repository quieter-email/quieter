import { describe, expect, test } from "vite-plus/test";

import { createServerSentryOptions } from "./instrument.server";

describe("Cloudflare server Sentry options", () => {
  test("prefers request bindings and disables private request data", () => {
    const options = createServerSentryOptions({
      SENTRY_DSN: "https://worker@example.ingest.sentry.io/1",
      SENTRY_ENVIRONMENT: "worker-test",
    });

    expect(options.dsn).toBe("https://worker@example.ingest.sentry.io/1");
    expect(options.environment).toBe("worker-test");
    expect(options.release).toBeUndefined();
    expect(options.dataCollection).toStrictEqual({
      cookies: false,
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      httpBodies: [],
      httpHeaders: { request: false, response: false },
      stackFrameVariables: false,
      urlQueryParams: false,
      userInfo: false,
    });
  });

  test("sanitizes an event before transport", () => {
    const options = createServerSentryOptions({
      SENTRY_DSN: "https://worker@example.ingest.sentry.io/1",
    });
    const error = new Error("Unexpected provider failure");
    const event = {
      exception: { values: [{ value: error.message }] },
      request: { url: "https://quieter.email/api/chat?private=value" },
      tags: { operation: "chat:generation" },
      type: undefined,
      user: { id: "private-user-id" },
    };

    expect(
      options.beforeSend?.(event, { originalException: error })
    ).toStrictEqual({
      exception: { values: [{ value: error.message }] },
      tags: { operation: "chat:generation" },
      type: undefined,
    });
  });
});
