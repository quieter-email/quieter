import { describe, expect, test } from "vite-plus/test";

import { withApiRateLimitHeaders } from "./rate-limit-headers.server";

describe("api rate limit headers", () => {
  test("sets structured and compatibility rate limit headers", () => {
    const stamped = withApiRateLimitHeaders(
      new Response("{}", { status: 201 }),
      { limit: 60, windowMs: 60_000 },
      { remaining: 42, resetAt: new Date(1000) },
      new Date(0)
    );

    expect(stamped.headers.get("ratelimit")).toBe(
      "limit=60, remaining=42, reset=1"
    );
    expect(stamped.headers.get("ratelimit-policy")).toBe("60;w=60");
    expect(stamped.status).toBe(201);
  });

  test("sets compatibility rate limit headers", () => {
    const stamped = withApiRateLimitHeaders(
      new Response(null),
      { limit: 60, windowMs: 60_000 },
      { remaining: 42, resetAt: new Date(1000) },
      new Date(0)
    );

    expect(stamped.headers.get("ratelimit-limit")).toBe("60");
    expect(stamped.headers.get("ratelimit-remaining")).toBe("42");
    expect(stamped.headers.get("ratelimit-reset")).toBe("1");
  });

  test("never reports zero seconds until reset", () => {
    const stamped = withApiRateLimitHeaders(
      new Response(null),
      { limit: 600, windowMs: 60_000 },
      { remaining: 599, resetAt: new Date(500) },
      new Date(10_000)
    );

    expect(stamped.headers.get("ratelimit-reset")).toBe("1");
    expect(stamped.headers.get("ratelimit")).toContain("reset=1");
  });
});
