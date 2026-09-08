import { serverEnv } from "@quieter/env/server";
import { consumeRateLimit } from "@quieter/orpc/abuse-protection";

import { reportServerError } from "./server-error-reporting";

const fallbackRateLimitBuckets = new Map<
  string,
  { count: number; expiresAt: number }
>();

const getRateLimitPolicy = (pathname: string) => {
  if (pathname.startsWith("/api/auth")) {
    return { group: "auth", limit: 20, windowMs: 60_000 };
  }
  if (pathname === "/api/waitlist") {
    return { group: "waitlist", limit: 5, windowMs: 60 * 60_000 };
  }
  if (pathname === "/api/v1/send") {
    return { group: "send", limit: 60, windowMs: 60_000 };
  }
  if (pathname.includes("/chat")) {
    return { group: "chat", limit: 120, windowMs: 60_000 };
  }
  return { group: "default", limit: 600, windowMs: 60_000 };
};

const consumeFallbackRateLimit = (input: {
  key: string;
  limit: number;
  windowMs: number;
}) => {
  const now = Date.now();
  if (fallbackRateLimitBuckets.size >= 1000) {
    for (const [key, candidate] of fallbackRateLimitBuckets) {
      if (candidate.expiresAt <= now) {
        fallbackRateLimitBuckets.delete(key);
      }
    }
    if (
      !fallbackRateLimitBuckets.has(input.key) &&
      fallbackRateLimitBuckets.size >= 1000
    ) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(now + input.windowMs),
      };
    }
  }
  const existing = fallbackRateLimitBuckets.get(input.key);
  const bucket =
    !existing || existing.expiresAt <= now
      ? { count: 1, expiresAt: now + input.windowMs }
      : { count: existing.count + 1, expiresAt: existing.expiresAt };

  fallbackRateLimitBuckets.set(input.key, bucket);

  return {
    allowed: bucket.count <= input.limit,
    remaining: Math.max(0, input.limit - bucket.count),
    resetAt: new Date(bucket.expiresAt),
  };
};

export const getRequestRateLimit = async (request: Request) => {
  const { pathname } = new URL(request.url);
  if (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    pathname === "/api/auth/polar/webhooks"
  ) {
    return null;
  }
  const policy = getRateLimitPolicy(pathname);
  const clientAddress =
    request.headers.get("cf-connecting-ip")?.trim() ||
    (serverEnv.NODE_ENV === "development"
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined) ||
    "unknown";
  const input = {
    key: `${policy.group}:${clientAddress}`,
    limit: policy.limit,
    windowMs: policy.windowMs,
  };
  try {
    return { policy, result: await consumeRateLimit(input) };
  } catch (error) {
    reportServerError(error, "rate-limit");
    return { policy, result: consumeFallbackRateLimit(input) };
  }
};
