import { ORPCError } from "@orpc/server";
import { GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { db } from "@quieter/database/client";
import {
  aiMemoryMailboxState,
  gmailCredential,
  gmailOAuthState,
  mailbox,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { decryptSecret, GMAIL_SCOPES } from "../src/gmail-mailbox-access";
import { completeGmailOAuth } from "../src/mailbox/service";

const state = vi.hoisted(() => {
  const failures: { learning: Error | null } = { learning: null };
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "gmail-oauth-test-client");
  vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", crypto.randomUUID());
  vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY", crypto.randomUUID());
  return {
    accessToken: crypto.randomUUID(),
    databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
    emailAddress: "",
    failures,
    grantAccepted: true,
    organizationId: "",
    refreshToken: crypto.randomUUID(),
    stateId: "",
    userId: "",
  };
});
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The callback only needs these browser session identity fields.
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: async () => {
    await Promise.resolve();
    return {
      session: { id: state.userId },
      user: { id: state.userId },
    };
  },
}));
vi.mock(import("../src/ai-memory-capture"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    queueMailboxMemoryBootstrap: async (input: {
      mailboxId: string;
      userId: string;
    }) => {
      if (state.failures.learning !== null) {
        throw state.failures.learning;
      }
      await actual.queueMailboxMemoryBootstrap(input);
    },
  };
});
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: vi.fn<typeof reportError>(),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "Gmail OAuth memory setup isolation",
  () => {
    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Gmail OAuth integration requires loopback quieter_migration_test."
        );
      }
    });

    beforeEach(async () => {
      state.userId = crypto.randomUUID();
      state.organizationId = crypto.randomUUID();
      state.stateId = crypto.randomUUID();
      state.emailAddress = `${state.userId}@example.test`;
      state.grantAccepted = true;
      state.failures.learning = null;
      vi.mocked(reportError).mockClear();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) => {
          await Promise.resolve();
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/token") {
            return state.grantAccepted
              ? Response.json({
                  access_token: state.accessToken,
                  expires_in: 3600,
                  id_token: state.userId,
                  refresh_token: state.refreshToken,
                  scope: GMAIL_SCOPES.join(" "),
                  token_type: "Bearer",
                })
              : Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          if (url.pathname === "/tokeninfo") {
            return Response.json({
              aud: "gmail-oauth-test-client",
              email: state.emailAddress,
              email_verified: "true",
              exp: Math.floor(Date.now() / 1000) + 3600,
              iss: "https://accounts.google.com",
              sub: state.userId,
            });
          }
          if (url.pathname === "/gmail/v1/users/me/profile") {
            return Response.json({
              emailAddress: state.emailAddress,
              historyId: "100",
            });
          }
          throw new Error("Unexpected OAuth fixture request.");
        })
      );
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: state.emailAddress,
        emailVerified: true,
        id: state.userId,
        name: "OAuth fixture",
        updatedAt: now,
      });
      await db.insert(organization).values({
        billingOwnerUserId: state.userId,
        createdAt: now,
        id: state.organizationId,
        name: "OAuth fixture",
        slug: state.organizationId,
      });
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId: state.organizationId,
        role: "owner",
        userId: state.userId,
      });
      await db.insert(gmailOAuthState).values({
        codeVerifier: crypto.randomUUID(),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 600_000),
        id: state.stateId,
        organizationId: state.organizationId,
        returnTo: "/settings/mailboxes",
        userId: state.userId,
      });
    });

    afterEach(async () => {
      await db
        .delete(organization)
        .where(eq(organization.id, state.organizationId));
      await db.delete(user).where(eq(user.id, state.userId));
      vi.unstubAllGlobals();
    });

    afterAll(async () => {
      await db.$client.end();
      vi.unstubAllEnvs();
    });

    test("returns the completed connection and reports sanitized learning setup failure", async () => {
      state.failures.learning = new Error(
        `Private queue details for ${state.emailAddress} with ${state.accessToken}`
      );
      const connected = await completeGmailOAuth({
        code: "authorization-code",
        headers: new Headers(),
        state: state.stateId,
      });

      expect(connected.returnTo).toBe("/settings/mailboxes");
      const [saved] = await db
        .select()
        .from(mailbox)
        .innerJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
        .where(eq(mailbox.id, connected.mailboxId));
      expect(saved?.mailbox).toMatchObject({
        ownerUserId: state.userId,
        status: "connected",
      });
      expect(
        decryptSecret(saved?.gmailCredential.encryptedAccessToken ?? "")
      ).toBe(state.accessToken);
      expect(
        decryptSecret(saved?.gmailCredential.encryptedRefreshToken ?? "")
      ).toBe(state.refreshToken);
      const remainingState = await db
        .select()
        .from(gmailOAuthState)
        .where(eq(gmailOAuthState.id, state.stateId));
      expect(remainingState).toHaveLength(0);
      expect(reportError).toHaveBeenCalledOnce();
      const [reported, context] = vi.mocked(reportError).mock.calls[0] ?? [];
      expect(reported).toBeInstanceOf(Error);
      expect(reported).not.toHaveProperty("cause");
      const diagnostic = `${String(reported)} ${JSON.stringify(context)}`;
      expect(diagnostic).not.toContain(state.emailAddress);
      expect(diagnostic).not.toContain(state.accessToken);
      expect(diagnostic).not.toContain(state.userId);
      expect(diagnostic).not.toContain(connected.mailboxId);
    });

    test("still queues learning after a successful connection", async () => {
      const connected = await completeGmailOAuth({
        code: "authorization-code",
        headers: new Headers(),
        state: state.stateId,
      });
      const [queued] = await db
        .select()
        .from(aiMemoryMailboxState)
        .where(eq(aiMemoryMailboxState.mailboxId, connected.mailboxId));
      expect(queued).toMatchObject({
        status: "pending",
        userId: state.userId,
      });
      expect(reportError).not.toHaveBeenCalled();
    });

    test.each(["NOT_FOUND", "FORBIDDEN"] as const)(
      "completes without reporting expected %s learning authorization changes",
      async (code) => {
        state.failures.learning = new ORPCError(code);
        await expect(
          completeGmailOAuth({
            code: "authorization-code",
            headers: new Headers(),
            state: state.stateId,
          })
        ).resolves.toMatchObject({ returnTo: "/settings/mailboxes" });
        expect(reportError).not.toHaveBeenCalled();
      }
    );

    test("still rejects a failed OAuth grant", async () => {
      state.grantAccepted = false;
      await expect(
        completeGmailOAuth({
          code: "authorization-code",
          headers: new Headers(),
          state: state.stateId,
        })
      ).rejects.toBeInstanceOf(Error);
      const saved = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.ownerUserId, state.userId));
      expect(saved).toHaveLength(0);
      expect(reportError).not.toHaveBeenCalled();
    });

    test("still rejects persistence when the team has no mailbox capacity", async () => {
      const now = new Date();
      await db.insert(mailbox).values(
        Array.from({ length: GMAIL_MAILBOX_LIMITS.free }, () => ({
          createdAt: now,
          emailAddress: `${crypto.randomUUID()}@example.test`,
          id: crypto.randomUUID(),
          organizationId: state.organizationId,
          ownerUserId: state.userId,
          provider: "gmail" as const,
          updatedAt: now,
        }))
      );
      await expect(
        completeGmailOAuth({
          code: "authorization-code",
          headers: new Headers(),
          state: state.stateId,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const saved = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.emailAddress, state.emailAddress));
      expect(saved).toHaveLength(0);
      expect(reportError).not.toHaveBeenCalled();
    });
  }
);
