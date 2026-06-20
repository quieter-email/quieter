import { expect, test } from "bun:test";
import { withSecurityHeaders } from "./security-headers.server";

test("adds security headers to immutable redirect responses", () => {
  const response = withSecurityHeaders(Response.redirect("https://example.com/home", 302));

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://example.com/home");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});
