import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { withSecurityHeaders } from "./security-headers.server";

const configuration = vi.hoisted(() => ({
  MAIL_UPDATES_URL: "ws://127.0.0.1:8787/mail/live",
  QUIETER_DEPLOYMENT_ENV: "production",
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Exercise the policy with an isolated environment fixture.
vi.mock("@quieter/env/server", () => ({ serverEnv: configuration }));

describe("security headers", () => {
  beforeEach(() => {
    configuration.QUIETER_DEPLOYMENT_ENV = "production";
  });

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

  test.each([
    ["local", "ws://127.0.0.1:8787/mail/live", true],
    ["production", "ws://127.0.0.1:8787/mail/live", false],
    ["local", "ws://example.com/mail/live", false],
  ] as const)(
    "scopes the local WebSocket exception for %s and %s",
    (environment, url, allowed) => {
      configuration.QUIETER_DEPLOYMENT_ENV = environment;
      configuration.MAIL_UPDATES_URL = url;
      const policy =
        withSecurityHeaders(new Response(null)).headers.get(
          "content-security-policy"
        ) ?? "";
      expect(policy.includes(new URL(url).origin)).toBe(allowed);
    }
  );
});
