import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vite-plus/test";
import { hasValidAuthSessionToken } from "./site-password.server";

const secret = "test-session-secret";
const token = "session-token";
const signedToken = `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;

// Mock the auth session module
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: vi.fn(),
}));

describe("site password session bypass", () => {
  test("accepts signed secure and local Better Auth session cookies with valid live session", async () => {
    const { getSessionWithOrganization } = await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      session: { id: "session-1", userId: "user-1" },
    } as any);

    await expect(
      hasValidAuthSessionToken({ "__Secure-better-auth.session_token": signedToken }, secret),
    ).resolves.toBe(true);

    await expect(
      hasValidAuthSessionToken({ "better-auth.session_token": signedToken }, secret),
    ).resolves.toBe(true);
  });

  test("rejects missing and tampered session cookies", async () => {
    const { getSessionWithOrganization } = await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      session: { id: "session-1", userId: "user-1" },
    } as any);

    await expect(hasValidAuthSessionToken({}, secret)).resolves.toBe(false);
    await expect(
      hasValidAuthSessionToken(
        { "__Secure-better-auth.session_token": `${signedToken}tampered` },
        secret,
      ),
    ).resolves.toBe(false);
  });

  test("rejects valid signature with expired session", async () => {
    const { getSessionWithOrganization } = await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue(null);

    await expect(
      hasValidAuthSessionToken({ "__Secure-better-auth.session_token": signedToken }, secret),
    ).resolves.toBe(false);
  });

  test("rejects valid signature with revoked session", async () => {
    const { getSessionWithOrganization } = await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockResolvedValue({
      user: null,
      session: null,
    } as any);

    await expect(
      hasValidAuthSessionToken({ "__Secure-better-auth.session_token": signedToken }, secret),
    ).resolves.toBe(false);
  });

  test("rejects valid signature when session lookup fails", async () => {
    const { getSessionWithOrganization } = await import("@quieter/auth/session");
    vi.mocked(getSessionWithOrganization).mockRejectedValue(new Error("Database error"));

    await expect(
      hasValidAuthSessionToken({ "__Secure-better-auth.session_token": signedToken }, secret),
    ).resolves.toBe(false);
  });
});
