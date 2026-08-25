const getDesktopAuthCallbackOrigin = (request: Request | undefined) => {
  if (request === undefined) {
    return null;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/desktop-auth") {
    return null;
  }

  const callback = requestUrl.searchParams.get("callback");
  if (callback === null || callback.length > 256) {
    return null;
  }

  try {
    const callbackUrl = new URL(callback);
    if (
      callbackUrl.protocol !== "http:" ||
      (callbackUrl.hostname !== "127.0.0.1" &&
        callbackUrl.hostname !== "localhost") ||
      callbackUrl.pathname !== "/callback" ||
      callbackUrl.username ||
      callbackUrl.password ||
      callbackUrl.search ||
      callbackUrl.hash ||
      callbackUrl.port === ""
    ) {
      return null;
    }

    const port = Number(callbackUrl.port);
    return Number.isInteger(port) && port > 0 && port < 65_536
      ? callbackUrl.origin
      : null;
  } catch {
    return null;
  }
};

export const withSecurityHeaders = (response: Response, request?: Request) => {
  const headers = new Headers(response.headers);
  const desktopAuthCallbackOrigin = getDesktopAuthCallbackOrigin(request);
  const connectSources = ["connect-src 'self' https: wss:"];
  const formActions = ["form-action 'self'"];

  if (desktopAuthCallbackOrigin !== null) {
    connectSources.push(desktopAuthCallbackOrigin);
    formActions.push(desktopAuthCallbackOrigin);
  }

  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      connectSources.join(" "),
      "font-src 'self' data: https:",
      formActions.join(" "),
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
