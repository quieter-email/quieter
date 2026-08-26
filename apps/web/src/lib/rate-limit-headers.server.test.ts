import { describe, expect, test } from "vite-plus/test";

import { withApiRateLimitHeaders } from "./rate-limit-headers.server";

describe("api rate limit headers", () => {
  test("sets limit, remaining, and reset headers", () => {
    const response = new Response("{}", { status: 201 });
    const stamped = withApiRateLimitHeaders(
      response,
      { limit: 60 },
      {
        remaining: 42,
        resetAt: new Date(1000),
      },
      new Date(0)
    );

    expect(stamped.headers.get("ratelimit-limit")).toBe("60");
    expect(stamped.headers.get("ratelimit-remaining")).toBe("42");
    expect(stamped.headers.get("ratelimit-reset")).toBe("1");
    expect(stamped.status).toBe(201);
  });

  test("never reports zero seconds until reset", () => {
    const stamped = withApiRateLimitHeaders(
      new Response(null),
      { limit: 600 },
      { remaining: 599, resetAt: new Date(500) },
      new Date(10_000)
    );

    expect(stamped.headers.get("ratelimit-reset")).toBe("1");
  });
});
