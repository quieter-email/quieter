import type * as SentryModule from "@sentry/cloudflare";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { reportServerError } from "./server-error-reporting";

const captureException = vi.hoisted(() =>
  vi.fn<typeof SentryModule.captureException>()
);

vi.mock(import("@sentry/cloudflare"), () => ({ captureException }));

describe("server error reporting", () => {
  beforeEach(() => {
    captureException.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("keeps safe diagnostics and derives provider failure details", () => {
    const providerError = Object.assign(new Error("Provider failed"), {
      isRetryable: true,
      name: "APICallError",
      statusCode: 429,
    });
    const retryError = Object.assign(new Error("Retries exhausted"), {
      lastError: providerError,
      name: "RetryError",
    });

    reportServerError(retryError, "chat:stream", {
      mailboxId: "private-mailbox-id",
      model: "test-model",
      operation: "chat:generation",
      phase: "stream",
      provider: "test-provider",
    });

    expect(captureException).toHaveBeenCalledWith(retryError, {
      tags: {
        boundary: "chat:stream",
        errorType: "APICallError",
        model: "test-model",
        operation: "chat:generation",
        phase: "stream",
        provider: "test-provider",
        retryable: true,
        statusCode: 429,
      },
    });
  });
});
