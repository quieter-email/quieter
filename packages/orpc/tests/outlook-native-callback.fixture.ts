import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

import { db, withRequestDatabaseClient } from "@quieter/database/client";
import {
  mailbox,
  member,
  organization,
  outlookCredential,
  outlookMessage,
  outlookOAuthState,
  user,
} from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import postgres from "postgres";
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

import { cleanupMailboxesForDeletedOrganization } from "../../auth/src/organization";
import { decryptGmailCredentialSecret } from "../src/gmail-credential-crypto";
import {
  getExternalMailboxCapacity,
  withExternalMailboxCapacity,
} from "../src/mailbox/gmail-capacity";
import { createOutlookProjection } from "../src/outlook/projection";
import {
  completeOutlookOAuth,
  disconnectOutlookMailbox,
  startOutlookOAuth,
} from "../src/outlook/service";
import { cacheOutlookMessage } from "../src/outlook/storage";

const session = vi.hoisted(() => ({ id: "", userId: "" }));
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: async () =>
    await Promise.resolve({
      session: { id: session.id },
      user: { id: session.userId },
    }),
}));

const tenantId = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
type Exchange = {
  email: string;
  graphId: string;
  nonce: string;
  subject: string;
  barrier?: {
    entered: ReturnType<typeof Promise.withResolvers<boolean>>;
    release: ReturnType<typeof Promise.withResolvers<boolean>>;
  };
};
const exchanges = new Map<string, Exchange>();
const ownerId = `callback214-owner-${randomUUID()}`;
const otherUserId = `callback214-other-${randomUUID()}`;
const teamIds = new Set<string>();
let organizationId = "";
let tokenRequests = 0;

const start = async (mailboxId?: string) => {
  const result = await startOutlookOAuth({
    headers: new Headers(),
    mailboxId,
    organizationId,
    userId: ownerId,
  });
  const url = new URL(result.authorizationUrl);
  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");
  if (!state || !nonce) {
    throw new Error("The actual authorization request lacks its binding.");
  }
  const code = randomUUID();
  const exchange = {
    email: `${code}@example.invalid`,
    graphId: code,
    nonce,
    subject: code,
  };
  exchanges.set(code, exchange);
  return { code, exchange, state };
};
const complete = async (attempt: { code: string; state: string }) =>
  await completeOutlookOAuth({ ...attempt, headers: new Headers() });
const installTransport = () => {
  vi.stubGlobal(
    "fetch",
    async (
      resource: Parameters<typeof fetch>[0],
      options?: Parameters<typeof fetch>[1]
    ) => {
      const url = new URL(
        typeof resource === "string" || resource instanceof URL
          ? resource
          : resource.url
      );
      if (
        url.origin === "https://login.microsoftonline.com" &&
        url.pathname === "/common/oauth2/v2.0/token"
      ) {
        tokenRequests += 1;
        const parameters = await new Request(url, options).formData();
        const code = parameters.get("code");
        if (typeof code !== "string") {
          throw new TypeError("Unexpected authorization code type.");
        }
        const exchange = exchanges.get(code);
        if (exchange === undefined) {
          throw new Error("Unexpected synthetic authorization code.");
        }
        exchange.barrier?.entered.resolve(true);
        if (exchange.barrier !== undefined) {
          await exchange.barrier.release.promise;
        }
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "native214-key" })
        ).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({
            aud: requireServerEnv("OUTLOOK_MAIL_CLIENT_ID"),
            exp: now + 300,
            iat: now,
            iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
            nbf: now - 5,
            nonce: exchange.nonce,
            sub: exchange.subject,
            tid: tenantId,
          })
        ).toString("base64url");
        const signingInput = `${header}.${payload}`;
        const signature = createSign("RSA-SHA256")
          .update(signingInput)
          .sign(keys.privateKey)
          .toString("base64url");
        return Response.json({
          access_token: code,
          expires_in: 3600,
          id_token: `${signingInput}.${signature}`,
          refresh_token: `refresh:${code}`,
          scope: "User.Read Mail.Read",
          token_type: "Bearer",
        });
      }
      if (
        url.origin === "https://login.microsoftonline.com" &&
        url.pathname === `/${tenantId}/discovery/v2.0/keys`
      ) {
        return Response.json({
          keys: [
            {
              ...keys.publicKey.export({ format: "jwk" }),
              kid: "native214-key",
            },
          ],
        });
      }
      if (url.origin === "https://graph.microsoft.com") {
        const token = new Headers(options?.headers)
          .get("authorization")
          ?.replace(/^Bearer /u, "");
        const exchange = token === undefined ? undefined : exchanges.get(token);
        if (exchange === undefined) {
          throw new Error("Unexpected synthetic Graph token.");
        }
        if (url.pathname === "/v1.0/me") {
          return Response.json({
            displayName: "Synthetic owner",
            id: exchange.graphId,
            mail: exchange.email,
          });
        }
        if (url.pathname === "/v1.0/me/mailFolders") {
          return Response.json({ value: [] });
        }
      }
      throw new Error(
        "Native callback proof refuses every other network request."
      );
    }
  );
};

beforeAll(async () => {
  const now = new Date();
  await db.insert(user).values(
    [ownerId, otherUserId].map((id) => ({
      createdAt: now,
      email: `${id}@example.invalid`,
      emailVerified: true,
      id,
      name: id,
      updatedAt: now,
    }))
  );
});
beforeEach(async () => {
  session.userId = ownerId;
  session.id = randomUUID();
  tokenRequests = 0;
  exchanges.clear();
  installTransport();
  organizationId = `callback214-team-${randomUUID()}`;
  teamIds.add(organizationId);
  const now = new Date();
  await db.insert(organization).values({
    createdAt: now,
    id: organizationId,
    name: organizationId,
    slug: organizationId,
    updatedAt: now,
  });
  await db.insert(member).values({
    createdAt: now,
    id: randomUUID(),
    organizationId,
    role: "owner",
    userId: ownerId,
  });
  await db
    .update(organization)
    .set({ billingOwnerUserId: ownerId })
    .where(eq(organization.id, organizationId));
});
afterEach(async () => {
  for (const exchange of exchanges.values()) {
    exchange.barrier?.release.resolve(true);
  }
  await db.transaction(async (database) => {
    await database.execute(
      sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
    );
    await database
      .delete(mailbox)
      .where(
        and(
          eq(mailbox.ownerUserId, ownerId),
          inArray(mailbox.organizationId, [...teamIds])
        )
      );
    await database
      .delete(organization)
      .where(inArray(organization.id, [...teamIds]));
  });
  teamIds.clear();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db.delete(user).where(inArray(user.id, [ownerId, otherUserId]));
  await withRequestDatabaseClient(async (database) => {
    await database.$client.end({ timeout: 3 });
  });
});

describe("native retained Outlook OAuth admission", () => {
  test("a claimed callback cannot replay while its real token exchange is pending", async () => {
    const attempt = await start();
    const barrier = {
      entered: Promise.withResolvers<boolean>(),
      release: Promise.withResolvers<boolean>(),
    };
    exchanges.set(attempt.code, { ...attempt.exchange, barrier });
    const pending = complete(attempt);
    await barrier.entered.promise;
    try {
      await expect(complete(attempt)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(tokenRequests).toBe(1);
    } finally {
      barrier.release.resolve(true);
    }
    const result = await pending;
    const [credential] = await db
      .select()
      .from(outlookCredential)
      .where(eq(outlookCredential.mailboxId, result.mailboxId));
    expect(credential?.encryptedRefreshToken).not.toContain(attempt.code);
    expect(
      decryptGmailCredentialSecret(credential?.encryptedRefreshToken ?? "", {
        legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
      })
    ).toBe(`refresh:${attempt.code}`);
    expect(
      await db
        .select()
        .from(outlookOAuthState)
        .where(eq(outlookOAuthState.userId, ownerId))
    ).toHaveLength(0);
  });

  test("another actor or session cannot claim a connection receipt", async () => {
    const attempt = await start();
    const originalSessionId = session.id;
    session.id = randomUUID();
    await expect(complete(attempt)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    session.userId = otherUserId;
    session.id = originalSessionId;
    await expect(complete(attempt)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(tokenRequests).toBe(0);
    const [receipt] = await db
      .select()
      .from(outlookOAuthState)
      .where(eq(outlookOAuthState.userId, ownerId));
    expect(receipt).toMatchObject({ claimId: null, consumedAt: null });
  });

  test.each(["initial", "reconnect"] as const)(
    "disconnect cancels a claimed %s callback without resurrection",
    async (kind) => {
      const first = await start();
      const connected = await complete(first);
      const attempt = await start(
        kind === "reconnect" ? connected.mailboxId : undefined
      );
      const barrier = {
        entered: Promise.withResolvers<boolean>(),
        release: Promise.withResolvers<boolean>(),
      };
      exchanges.set(attempt.code, {
        ...first.exchange,
        barrier,
        nonce: attempt.exchange.nonce,
      });
      const pending = (async () => {
        try {
          return { value: await complete(attempt) };
        } catch (error) {
          return { error };
        }
      })();
      await barrier.entered.promise;
      try {
        await disconnectOutlookMailbox({
          mailboxId: connected.mailboxId,
          userId: ownerId,
        });
      } finally {
        barrier.release.resolve(true);
      }
      expect(await pending).toMatchObject({ error: { code: "BAD_REQUEST" } });
      expect(
        await db.select().from(mailbox).where(eq(mailbox.ownerUserId, ownerId))
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(outlookCredential)
          .where(eq(outlookCredential.ownerUserId, ownerId))
      ).toHaveLength(0);
    }
  );

  test("full capacity reconnect keeps one admission and rejects a wrong-provider reconnect", async () => {
    const first = await start();
    const connected = await complete(first);
    const capacity = await getExternalMailboxCapacity(organizationId);
    const now = new Date();
    const gmailIds = Array.from({ length: capacity.limit - 1 }, () =>
      randomUUID()
    );
    await db.insert(mailbox).values(
      gmailIds.map((id) => ({
        accessMode: "private" as const,
        createdAt: now,
        emailAddress: `${id}@example.invalid`,
        id,
        organizationId,
        ownerUserId: ownerId,
        provider: "gmail" as const,
        status: "connected" as const,
        updatedAt: now,
      }))
    );
    await expect(start()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const attempt = await start(connected.mailboxId);
    exchanges.set(attempt.code, {
      ...first.exchange,
      nonce: attempt.exchange.nonce,
    });
    await expect(complete(attempt)).resolves.toMatchObject({
      mailboxId: connected.mailboxId,
    });
    const after = await getExternalMailboxCapacity(organizationId);
    expect(after.used).toBe(capacity.limit);
    await expect(
      withExternalMailboxCapacity(
        {
          mailboxId: gmailIds[0] ?? "missing",
          organizationId,
          provider: "outlook",
          userId: ownerId,
        },
        async () => await Promise.resolve(true)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      withExternalMailboxCapacity(
        {
          mailboxId: gmailIds[0] ?? "missing",
          organizationId,
          provider: "gmail",
          userId: ownerId,
        },
        async () => await Promise.resolve(true)
      )
    ).resolves.toBe(true);
  });

  test("receipt-first callback and disconnect serialize under actual three-connection locks", async () => {
    const first = await start();
    const connected = await complete(first);
    const attempt = await start(connected.mailboxId);
    exchanges.set(attempt.code, {
      ...first.exchange,
      nonce: attempt.exchange.nonce,
    });
    vi.resetModules();
    const secondService = await import("../src/outlook/service");
    const secondDatabase = await import("@quieter/database/client");
    const witness = postgres(requireServerEnv("DATABASE_URL"), {
      connect_timeout: 3,
      fetch_types: false,
      max: 1,
    });
    let callback:
      | Promise<
          { value: Awaited<ReturnType<typeof complete>> } | { error: unknown }
        >
      | undefined;
    let disconnected:
      | Promise<{ value: unknown } | { error: unknown }>
      | undefined;
    try {
      await witness.begin(async (transaction) => {
        const [owner] = await transaction<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        if (owner === undefined) {
          throw new Error("Missing native lock witness.");
        }
        await transaction`select id from organization where id = ${organizationId} for update`;
        callback = (async () => {
          try {
            return { value: await complete(attempt) };
          } catch (error) {
            return { error };
          }
        })();
        let callbackPid: number | undefined;
        await vi.waitFor(
          async () => {
            await transaction`select pg_stat_clear_snapshot()`;
            const rows = await transaction<
              { blockers: number[]; pid: number; query: string }[]
            >`select to_json(pg_blocking_pids(pid)) as blockers, pid, query from pg_stat_activity where datname = current_database() and backend_type = 'client backend'`;
            callbackPid = rows.find(
              (row) =>
                row.pid !== owner.pid &&
                row.blockers.includes(owner.pid) &&
                row.query.includes('"organization"')
            )?.pid;
            expect(callbackPid).toBeDefined();
          },
          { interval: 25, timeout: 5000 }
        );
        disconnected = (async () => {
          try {
            return {
              value: await secondService.disconnectOutlookMailbox({
                mailboxId: connected.mailboxId,
                userId: ownerId,
              }),
            };
          } catch (error) {
            return { error };
          }
        })();
        await vi.waitFor(
          async () => {
            await transaction`select pg_stat_clear_snapshot()`;
            const rows = await transaction<
              { blockers: number[]; pid: number; query: string }[]
            >`select to_json(pg_blocking_pids(pid)) as blockers, pid, query from pg_stat_activity where datname = current_database() and backend_type = 'client backend'`;
            expect(rows).toHaveLength(3);
            expect(
              rows.some(
                (row) =>
                  callbackPid !== undefined &&
                  row.blockers.includes(callbackPid) &&
                  row.query.includes('"outlookOAuthState"')
              )
            ).toBe(true);
          },
          { interval: 25, timeout: 5000 }
        );
      });
      expect(await callback).toMatchObject({
        value: { mailboxId: connected.mailboxId },
      });
      expect(await disconnected).toMatchObject({
        value: { disconnected: true },
      });
      expect(
        await db
          .select()
          .from(mailbox)
          .where(eq(mailbox.id, connected.mailboxId))
      ).toHaveLength(0);
    } finally {
      await Promise.allSettled([callback, disconnected]);
      await witness.end({ timeout: 3 });
      await secondDatabase.withRequestDatabaseClient(async (database) => {
        await database.$client.end({ timeout: 3 });
      });
    }
  });

  test("reconnect rejects a changed external identity without replacing retained credentials", async () => {
    const first = await start();
    const connected = await complete(first);
    const attempt = await start(connected.mailboxId);
    exchanges.set(attempt.code, {
      ...first.exchange,
      nonce: attempt.exchange.nonce,
      subject: "different-subject",
    });
    await expect(complete(attempt)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const [credential] = await db
      .select()
      .from(outlookCredential)
      .where(eq(outlookCredential.mailboxId, connected.mailboxId));
    expect(credential).toMatchObject({
      generation: 0,
      subject: first.exchange.subject,
    });
    expect(
      decryptGmailCredentialSecret(credential?.encryptedAccessToken ?? "", {
        legacyKey: requireServerEnv("OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY"),
      })
    ).toBe(first.code);
  });

  test("organization deletion relocates the surviving owner's private cache and credential", async () => {
    const connected = await complete(await start());
    const messageId = randomUUID();
    await cacheOutlookMessage({
      expectedChangeKey: null,
      expectedContentRevision: 0,
      projection: createOutlookProjection({
        attachments: [],
        kind: "full",
        message: {
          body: { content: "Synthetic retained cache", contentType: "text" },
          changeKey: "opaque-native-revision",
          conversationId: messageId,
          hasAttachments: false,
          id: messageId,
          isDraft: false,
          isRead: false,
          parentFolderId: "inbox",
          receivedDateTime: new Date().toISOString(),
        },
      }),
      scope: { generation: 0, mailboxId: connected.mailboxId, userId: ownerId },
    });
    const targetId = `callback214-target-${randomUUID()}`;
    teamIds.add(targetId);
    const now = new Date();
    await db.insert(organization).values({
      createdAt: now,
      id: targetId,
      name: targetId,
      slug: targetId,
      updatedAt: now,
    });
    await db.insert(member).values({
      createdAt: now,
      id: randomUUID(),
      organizationId: targetId,
      role: "owner",
      userId: ownerId,
    });
    await db
      .update(organization)
      .set({ billingOwnerUserId: ownerId })
      .where(eq(organization.id, targetId));
    await cleanupMailboxesForDeletedOrganization(organizationId);
    await db.delete(organization).where(eq(organization.id, organizationId));
    const [retained] = await db
      .select({
        organizationId: mailbox.organizationId,
        ownerUserId: outlookCredential.ownerUserId,
      })
      .from(mailbox)
      .innerJoin(outlookCredential, eq(outlookCredential.mailboxId, mailbox.id))
      .where(eq(mailbox.id, connected.mailboxId));
    expect(retained).toMatchObject({
      organizationId: targetId,
      ownerUserId: ownerId,
    });
    expect(
      await db
        .select({ messageId: outlookMessage.messageId })
        .from(outlookMessage)
        .where(
          and(
            eq(outlookMessage.mailboxId, connected.mailboxId),
            eq(outlookMessage.messageId, messageId)
          )
        )
    ).toMatchObject([{ messageId }]);
  });
});
