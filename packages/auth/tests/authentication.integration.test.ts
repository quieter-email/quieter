import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import { session, user } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const { databaseUrl, sendMagicLinkEmail } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  sendMagicLinkEmail: vi
    .fn<(input: { email: string; url: string }) => Promise<void>>()
    .mockResolvedValue(),
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      BETTER_AUTH_URL: "http://localhost:3000",
      DATABASE_URL: databaseUrl,
    },
  };
});
vi.mock(import("../src/email"), () => ({
  sendMagicLinkEmail,
  sendVerificationEmail: vi.fn<() => Promise<void>>(),
}));

describe.skipIf(databaseUrl === undefined)(
  "authentication with PostgreSQL",
  () => {
    const userId = randomUUID();
    const email = `${userId}@example.com`;

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Authentication tests require loopback quieter_migration_test."
        );
      }
      await db.insert(user).values({
        createdAt: new Date(),
        email,
        emailVerified: true,
        id: userId,
        name: "Authentication fixture",
        updatedAt: new Date(),
      });
    });

    afterAll(async () => {
      await db.delete(user).where(eq(user.id, userId));
    });

    test("a magic link creates one session under concurrent redemption and sign-out revokes it", async () => {
      const { auth } = await import("../src/index");
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
          body: JSON.stringify({ callbackURL: "/", email }),
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          method: "POST",
        })
      );
      expect(response.status).toBe(200);
      const link = sendMagicLinkEmail.mock.calls[0]?.[0].url;
      expect(link).toBeDefined();
      if (link === undefined) {
        throw new Error("Authentication did not send a magic link.");
      }
      const results = await Promise.all([
        auth.handler(new Request(link)),
        auth.handler(new Request(link)),
      ]);
      const authenticated = results.filter((result) =>
        result.headers
          .getSetCookie()
          .some((cookie) => cookie.startsWith("better-auth.session_token="))
      );
      expect(authenticated).toHaveLength(1);
      await expect(
        db
          .select({ id: session.id })
          .from(session)
          .where(eq(session.userId, userId))
      ).resolves.toHaveLength(1);
      const cookie =
        authenticated[0]?.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ") ?? "";
      const current = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      expect(current?.user.id).toBe(userId);
      const signedOut = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-out", {
          headers: { cookie, origin: "http://localhost:3000" },
          method: "POST",
        })
      );
      expect(signedOut.status).toBe(200);
      await expect(
        auth.api.getSession({ headers: new Headers({ cookie }) })
      ).resolves.toBeNull();
    });
  }
);
