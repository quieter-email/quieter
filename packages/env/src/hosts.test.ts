import { describe, expect, test } from "vite-plus/test";

import {
  crossSurfaceRedirect,
  crossSurfaceTarget,
  shouldProxyAppApi,
} from "./hosts";

describe("public host split", () => {
  test("sends marketing paths from the app host to the site and keeps the query", () => {
    expect(
      crossSurfaceRedirect("https://app.quieter.email/home?ref=1", "app")
    ).toBe("https://quieter.email/home?ref=1");
    expect(
      crossSurfaceRedirect("https://app.quieter.email/llms.txt", "app")
    ).toBe("https://quieter.email/llms.txt");
    expect(
      crossSurfaceTarget("https://app.quieter.email/privacy/", "app", false)
    ).toBe("https://quieter.email/privacy");
  });

  test("sends product paths from the site host to the app", () => {
    expect(
      crossSurfaceRedirect("https://quieter.email/auth?returnTo=%2F", "site")
    ).toBe("https://app.quieter.email/auth?returnTo=%2F");
    expect(
      crossSurfaceRedirect("https://www.quieter.email/api/send", "site")
    ).toBe("https://app.quieter.email/api/send");
    expect(
      crossSurfaceRedirect("https://quieter.email/openapi.json", "site")
    ).toBe("https://app.quieter.email/openapi.json");
  });

  test("leaves the landing root, waitlist, health, and static files in place", () => {
    expect(crossSurfaceRedirect("https://quieter.email/", "site")).toBeNull();
    expect(
      crossSurfaceRedirect("https://quieter.email/api/waitlist", "site")
    ).toBeNull();
    expect(
      crossSurfaceRedirect("https://app.quieter.email/api/waitlist", "app")
    ).toBe("https://quieter.email/api/waitlist");
    expect(
      crossSurfaceRedirect("https://quieter.email/api/health", "site")
    ).toBeNull();
    expect(
      crossSurfaceRedirect(
        "https://app.quieter.email/assets/build-id.txt",
        "app"
      )
    ).toBeNull();
    expect(
      crossSurfaceRedirect("https://quieter.email/robots.txt", "site")
    ).toBeNull();
    expect(
      crossSurfaceRedirect("https://app.quieter.email/landing/hero.png", "app")
    ).toBeNull();
  });

  test("uses local ports and ignores unrelated hosts", () => {
    expect(crossSurfaceRedirect("http://localhost:3000/home", "app")).toBe(
      "http://localhost:3001/home"
    );
    expect(
      crossSurfaceRedirect("http://127.0.0.1:3001/site-password", "site")
    ).toBe("http://localhost:3000/site-password");
    expect(
      crossSurfaceRedirect("https://preview.example/home", "app")
    ).toBeNull();
  });

  test("proxies only app APIs that arrive on the site", () => {
    expect(shouldProxyAppApi("/api/send", "site")).toBeTruthy();
    expect(shouldProxyAppApi("/api/auth/polar/webhooks", "site")).toBeTruthy();
    expect(shouldProxyAppApi("/api/waitlist", "site")).toBeFalsy();
    expect(shouldProxyAppApi("/api/health", "site")).toBeFalsy();
    expect(shouldProxyAppApi("/api/send", "app")).toBeFalsy();
    expect(shouldProxyAppApi("/home", "site")).toBeFalsy();
  });
});
