// Attaches RFC 9331-style rate limit headers so API clients can self-throttle.
export const withApiRateLimitHeaders = (
  response: Response,
  policy: { limit: number; windowMs: number },
  result: { remaining: number; resetAt: Date },
  now = new Date()
) => {
  const headers = new Headers(response.headers);
  const resetSeconds = Math.max(
    1,
    Math.ceil((result.resetAt.getTime() - now.getTime()) / 1000)
  );

  headers.set(
    "ratelimit",
    `limit=${policy.limit}, remaining=${result.remaining}, reset=${resetSeconds}`
  );
  headers.set(
    "ratelimit-policy",
    `${policy.limit};w=${Math.ceil(policy.windowMs / 1000)}`
  );
  headers.set("ratelimit-limit", String(policy.limit));
  headers.set("ratelimit-remaining", String(result.remaining));
  headers.set("ratelimit-reset", String(resetSeconds));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
