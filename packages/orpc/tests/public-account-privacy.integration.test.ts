import { randomUUID } from "node:crypto";

import { RPCHandler } from "@orpc/server/fetch";
import { db } from "@quieter/database/client";
import { account, user, waitlistSignup } from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { appRouter } from "../src/routers/index";
import { recordWaitlistSignup } from "../src/waitlist";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: { ...original.serverEnv, DATABASE_URL: databaseUrl },
  };
});

describe.skipIf(databaseUrl === undefined)("public account privacy", () => {
  const id = randomUUID();
  const registeredEmail = `${id}@example.com`;
  const googleEmail = `google-${id}@example.com`;
  const absentEmail = `absent-${id}@example.com`;

  beforeAll(async () => {
    const url = new URL(databaseUrl ?? "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/quieter_migration_test"
    ) {
      throw new Error("Privacy tests require loopback quieter_migration_test.");
    }
    await db.insert(user).values(
      [registeredEmail, googleEmail].map((email) => ({
        createdAt: new Date(),
        email,
        emailVerified: true,
        id: email,
        name: "Privacy fixture",
        updatedAt: new Date(),
      }))
    );
    await db.insert(account).values({
      accountId: id,
      createdAt: new Date(),
      id,
      providerId: "google",
      updatedAt: new Date(),
      userId: googleEmail,
    });
  });

  afterAll(async () => {
    await db
      .delete(user)
      .where(inArray(user.email, [registeredEmail, googleEmail]));
    await db
      .delete(waitlistSignup)
      .where(eq(waitlistSignup.email, absentEmail));
  });

  test.each(["GET", "POST"])(
    "the former account status route exposes no account metadata through %s",
    async (method) => {
      const handler = new RPCHandler(appRouter);
      for (const email of [
        registeredEmail,
        googleEmail,
        absentEmail,
        googleEmail.toUpperCase(),
      ]) {
        const input = JSON.stringify({ json: { email } });
        const response = await handler.handle(
          new Request(
            `https://example.test/api/orpc/auth/getUserStatus${method === "GET" ? `?data=${encodeURIComponent(input)}` : ""}`,
            {
              ...(method === "POST" ? { body: input } : {}),
              headers: { "content-type": "application/json" },
              method,
            }
          ),
          { context: { db, headers: new Headers() }, prefix: "/api/orpc" }
        );
        expect(response.matched).toBeFalsy();
      }
    }
  );

  test("new and repeated waitlist submissions acknowledge identically and persist once", async () => {
    const first = await recordWaitlistSignup(absentEmail);
    const repeated = await recordWaitlistSignup(absentEmail);
    expect(repeated).toStrictEqual(first);
    await expect(
      db
        .select()
        .from(waitlistSignup)
        .where(eq(waitlistSignup.email, absentEmail))
    ).resolves.toHaveLength(1);
  });
});
