import { serverEnv } from "@quieter/env/server";

export const withSecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  const connections = ["'self'", "https:", "wss:"];
  if (
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
    serverEnv.MAIL_UPDATES_URL
  ) {
    const liveUrl = new URL(serverEnv.MAIL_UPDATES_URL);
    if (
      liveUrl.protocol === "ws:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(liveUrl.hostname)
    ) {
      connections.push(liveUrl.origin);
    }
  }
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      `connect-src ${connections.join(" ")}`,
      "font-src 'self' data: https:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https:",
      "object-src 'none'",
      // PostHog serves its browser bundle (and its lazily loaded add-ons) from
      // the regional assets host, so 'self' alone silently blocks analytics.
      "script-src 'self' 'unsafe-inline' https://eu-assets.i.posthog.com https://us-assets.i.posthog.com",
      "style-src 'self' 'unsafe-inline' https:",
    ].join("; ")
  );
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
