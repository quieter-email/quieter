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

import type { auth as configuredAuth } from "../src/index";

const { databaseUrl, sendMagicLinkEmail, sendVerificationEmail } = vi.hoisted(
  () => ({
    databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
    sendMagicLinkEmail: vi
      .fn<(input: { email: string; url: string }) => Promise<void>>()
      .mockResolvedValue(),
    sendVerificationEmail: vi
      .fn<(input: { email: string; url: string }) => Promise<void>>()
      .mockResolvedValue(),
  })
);
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
  sendVerificationEmail,
}));

describe.skipIf(databaseUrl === undefined)(
  "authentication with PostgreSQL",
  () => {
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    let auth: typeof configuredAuth;

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
      ({ auth } = await import("../src/index"));
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

    test("email change conceals target membership and completes only after verification", async () => {
      const occupiedId = randomUUID();
      const occupiedEmail = `${occupiedId}@example.com`;
      const newEmail = `changed-${userId}@example.com`;
      await db.insert(user).values({
        createdAt: new Date(),
        email: occupiedEmail,
        emailVerified: true,
        id: occupiedId,
        name: "Occupied fixture",
        updatedAt: new Date(),
      });
      try {
        await auth.api.signInMagicLink({
          body: { email },
          headers: new Headers({ origin: "http://localhost:3000" }),
        });
        const link = sendMagicLinkEmail.mock.lastCall?.[0].url;
        if (link === undefined) {
          throw new Error("Authentication did not send a magic link.");
        }
        const authenticated = await auth.handler(new Request(link));
        const cookie = authenticated.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const responses = [];
        sendVerificationEmail.mockClear();
        for (const target of [occupiedEmail, newEmail]) {
          const response = await auth.handler(
            new Request("http://localhost:3000/api/auth/change-email", {
              body: JSON.stringify({
                callbackURL: "/settings?tab=account",
                newEmail: target,
              }),
              headers: {
                "content-type": "application/json",
                cookie,
                origin: "http://localhost:3000",
              },
              method: "POST",
            })
          );
          const body: unknown = await response.json();
          responses.push({
            body,
            status: response.status,
          });
        }
        expect(responses[0]).toStrictEqual(responses[1]);
        expect(responses[1]).toMatchObject({ status: 200 });
        await expect(
          db.select({ email: user.email }).from(user).where(eq(user.id, userId))
        ).resolves.toMatchObject([{ email }]);
        expect(sendVerificationEmail).toHaveBeenCalledOnce();
        const verification = sendVerificationEmail.mock.lastCall?.[0];
        expect(verification?.email).toBe(newEmail);
        if (verification === undefined) {
          throw new Error("Email change did not send verification.");
        }
        const verified = await auth.handler(new Request(verification.url));
        expect(verified.status).toBe(302);
        await expect(
          db.select({ email: user.email }).from(user).where(eq(user.id, userId))
        ).resolves.toMatchObject([{ email: newEmail }]);
      } finally {
        await db.delete(user).where(eq(user.id, occupiedId));
      }
    });
  }
);
