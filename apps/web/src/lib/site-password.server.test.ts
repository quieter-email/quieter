import { createHmac } from "node:crypto";
import { describe, expect, test } from "vite-plus/test";
import { hasValidAuthSessionToken } from "./site-password.server";

const secret = "test-session-secret";
const token = "session-token";
const signedToken = `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;

describe("site password session bypass", () => {
  test("accepts signed secure and local Better Auth session cookies", () => {
    expect(
      hasValidAuthSessionToken({ "__Secure-better-auth.session_token": signedToken }, secret),
    ).toBe(true);
    expect(hasValidAuthSessionToken({ "better-auth.session_token": signedToken }, secret)).toBe(
      true,
    );
  });

  test("rejects missing and tampered session cookies", () => {
    expect(hasValidAuthSessionToken({}, secret)).toBe(false);
    expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": `${signedToken}tampered` },
        secret,
      ),
    ).toBe(false);
  });
});
