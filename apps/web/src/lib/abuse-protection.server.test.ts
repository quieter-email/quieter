import { consumeRateLimit } from "@quieter/orpc/abuse-protection";
import type { cleanupRateLimitBuckets } from "@quieter/orpc/abuse-protection";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { getRequestRateLimit } from "./abuse-protection.server";
import type { reportServerError } from "./server-error-reporting";

vi.mock(import("@quieter/orpc/abuse-protection"), () => ({
  cleanupRateLimitBuckets: vi.fn<typeof cleanupRateLimitBuckets>(),
  consumeRateLimit: vi.fn<typeof consumeRateLimit>(),
}));
vi.mock(import("./server-error-reporting"), () => ({
  reportServerError: vi.fn<typeof reportServerError>(),
}));

describe("request rate limiting", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  test("webhook bursts do not consume the interactive login budget", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date(),
    });
    const deliveries = await Promise.all(
      Array.from(
        { length: 100 },
        async () =>
          await getRequestRateLimit(
            new Request("https://quieter.email/api/auth/polar/webhooks", {
              method: "POST",
            })
          )
      )
    );
    expect(deliveries.every((result) => result === null)).toBeTruthy();
    const login = await getRequestRateLimit(
      new Request("https://quieter.email/api/auth/sign-in/email", {
        method: "POST",
      })
    );
    expect(login?.policy.group).toBe("auth");
    expect(login?.result.remaining).toBe(19);
    expect(consumeRateLimit).toHaveBeenCalledExactlyOnceWith({
      key: "auth:unknown",
      limit: 20,
      windowMs: 60_000,
    });
  });

  test("read-only requests have no fabricated quota result", async () => {
    const result = await getRequestRateLimit(
      new Request("https://quieter.email/api/v1/messages/one")
    );
    expect(result).toBeNull();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  test("caps fallback identities during an outage and admits traffic after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    vi.mocked(consumeRateLimit).mockRejectedValue(
      new Error("database unavailable")
    );
    const results = await Promise.all(
      Array.from(
        { length: 1001 },
        async (_, index) =>
          await getRequestRateLimit(
            new Request("https://quieter.email/api/auth/sign-in/email", {
              headers: {
                "cf-connecting-ip": `192.0.${Math.floor(index / 256)}.${index % 256}`,
              },
              method: "POST",
            })
          )
      )
    );
    expect(
      results.filter((result) => result?.result.allowed === true)
    ).toHaveLength(1000);
    expect(results.at(-1)?.result.allowed).toBeFalsy();
    vi.setSystemTime(new Date("2026-09-07T00:02:00Z"));
    const recovered = await getRequestRateLimit(
      new Request("https://quieter.email/api/auth/sign-in/email", {
        method: "POST",
      })
    );
    expect(recovered?.result.allowed).toBeTruthy();
  });
});
