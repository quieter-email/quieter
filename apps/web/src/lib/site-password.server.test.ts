import { createHmac } from "node:crypto";

import type { getSessionWithOrganization as getSessionWithOrganizationType } from "@quieter/auth/session";
import { describe, expect, test, vi } from "vite-plus/test";

import { hasValidAuthSessionToken } from "./site-password.server";

const secret = "test-session-secret";
const token = "session-token";
const signedToken = `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
type AuthSession = NonNullable<
  Awaited<ReturnType<typeof getSessionWithOrganizationType>>
>;

const createLiveAuthSession = (): AuthSession => {
  const now = new Date();
  return {
    session: {
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      id: "session-1",
      ipAddress: null,
      token: "session-token",
      updatedAt: now,
      userAgent: null,
      userId: "user-1",
    },
    user: {
      createdAt: now,
      email: "test@example.com",
      emailVerified: true,
      id: "user-1",
      image: null,
      name: "Test User",
      termsAcceptedAt: now,
      updatedAt: now,
    },
  };
};

// Mock the auth session module
vi.mock(import("@quieter/auth/session"), () => ({
  getSessionWithOrganization: vi.fn<typeof getSessionWithOrganizationType>(),
}));

describe("site password session bypass", () => {
  test("accepts signed secure and local Better Auth session cookies with valid live session", async () => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue(
      createLiveAuthSession()
    );

    await expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": signedToken },
        secret
      )
    ).resolves.toBeTruthy();

    await expect(
      hasValidAuthSessionToken(
        { "better-auth.session_token": signedToken },
        secret
      )
    ).resolves.toBeTruthy();
  });

  test("rejects missing and tampered session cookies", async () => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue(
      createLiveAuthSession()
    );

    await expect(hasValidAuthSessionToken({}, secret)).resolves.toBeFalsy();
    await expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": `${signedToken}tampered` },
        secret
      )
    ).resolves.toBeFalsy();
  });

  test("rejects valid signature with expired session", async () => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue(null);

    await expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": signedToken },
        secret
      )
    ).resolves.toBeFalsy();
  });

  test("rejects valid signature with revoked session", async () => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue(null);

    await expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": signedToken },
        secret
      )
    ).resolves.toBeFalsy();
  });

  test("rejects valid signature when session lookup fails", async () => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockRejectedValue(
      new Error("Database error")
    );

    await expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": signedToken },
        secret
      )
    ).resolves.toBeFalsy();
  });
});
