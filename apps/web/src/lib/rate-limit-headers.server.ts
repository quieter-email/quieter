// Attaches RFC 9331-style rate limit headers so API clients can self-throttle.
export const withApiRateLimitHeaders = (
  response: Response,
  policy: { limit: number },
  result: { remaining: number; resetAt: Date },
  now = new Date()
) => {
  const headers = new Headers(response.headers);
  headers.set("ratelimit-limit", String(policy.limit));
  headers.set("ratelimit-remaining", String(result.remaining));
  headers.set(
    "ratelimit-reset",
    String(
      Math.max(1, Math.ceil((result.resetAt.getTime() - now.getTime()) / 1000))
    )
  );

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
