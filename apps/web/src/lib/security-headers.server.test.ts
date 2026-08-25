import { describe, expect, test } from "vite-plus/test";

import { withSecurityHeaders } from "./security-headers.server";

describe("security headers", () => {
  test("adds security headers to immutable redirect responses", () => {
    const response = withSecurityHeaders(
      Response.redirect("https://example.com/home", 302)
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/home");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );
  });

  test("allows the analytics bundle host", () => {
    const response = withSecurityHeaders(new Response(null, { status: 200 }));
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(policy).toContain("https://eu-assets.i.posthog.com");
    expect(policy).toContain("https://us-assets.i.posthog.com");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  test("allows only the validated desktop loopback callback", () => {
    const callbackOrigin = "http://127.0.0.1:61234";
    const callback = `${callbackOrigin}/callback`;
    const response = withSecurityHeaders(
      new Response(null, { status: 200 }),
      new Request(
        `http://localhost:3000/desktop-auth?callback=${encodeURIComponent(callback)}`
      )
    );
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(policy).toContain(
      `connect-src 'self' https: wss: ${callbackOrigin}`
    );
    expect(policy).toContain(`form-action 'self' ${callbackOrigin}`);
  });

  test("does not widen the policy for an invalid desktop callback", () => {
    const callbackOrigin = "https://example.com";
    const response = withSecurityHeaders(
      new Response(null, { status: 200 }),
      new Request(
        `http://localhost:3000/desktop-auth?callback=${encodeURIComponent(`${callbackOrigin}/callback`)}`
      )
    );
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain(callbackOrigin);
  });
});
