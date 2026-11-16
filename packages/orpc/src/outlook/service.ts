import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  member,
  outlookCredential,
  outlookOAuthState,
  user,
} from "@quieter/database/schema";
import {
  getOutlookProfile,
  listOutlookMailFolders,
  OutlookGraphError,
} from "@quieter/outlook/graph";
import {
  createOutlookAuthorizationRequest,
  exchangeOutlookAuthorizationCode,
  OutlookOAuthError,
} from "@quieter/outlook/oauth";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";
import { pausePersonalAgentConnections } from "../mail-agent/authority";
import {
  getExternalMailboxCapacity,
  withExternalMailboxCapacity,
} from "../mailbox/gmail-capacity";
import {
  getOutlookMailConfiguration,
  loadOwnedOutlookCredential,
} from "./auth";

export { runAuthorizedOutlookMailbox } from "./auth";

export const startOutlookOAuth = async (input: {
  headers: Headers;
  mailboxId?: string;
  organizationId: string;
  returnTo?: string;
  userId: string;
}): Promise<{ authorizationUrl: string }> => {
  try {
    const configuration = getOutlookMailConfiguration();
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    const session = await getSessionWithOrganization(input.headers);
    if (session?.user.id !== input.userId || session.session === undefined) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Sign in before connecting a mailbox.",
      });
    }
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, input.organizationId),
          eq(member.userId, input.userId)
        )
      )
      .limit(1);
    if (membership === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Team not found." });
    }
    let generation: number | null = null;
    if (input.mailboxId === undefined) {
      const capacity = await getExternalMailboxCapacity(input.organizationId);
      if (capacity.used >= capacity.limit) {
        throw new ORPCError("FORBIDDEN", {
          message: `This team has reached its limit of ${capacity.limit} connected accounts. Disconnect an account or upgrade your plan.`,
        });
      }
    } else {
      const current = await loadOwnedOutlookCredential({
        mailboxId: input.mailboxId,
        userId: input.userId,
      });
      if (current.organizationId !== input.organizationId) {
        throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
      }
      ({ generation } = current.credential);
    }
    const request = createOutlookAuthorizationRequest(configuration.oauth);
    const authorization = new URL(request.authorizationUrl);
    const requestedScopes = authorization.searchParams.get("scope");
    if (!requestedScopes) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message:
          "The mailbox connection could not be started. Please try again.",
      });
    }
    const redirectOrigin = new URL(configuration.oauth.redirectUri).origin;
    let returnTo = "/settings?tab=mailboxes";
    if (
      input.returnTo !== undefined &&
      input.returnTo.startsWith("/") &&
      !input.returnTo.startsWith("//") &&
      input.returnTo.length <= 2048 &&
      !/[\\\p{Cc}]/u.test(input.returnTo)
    ) {
      const candidate = new URL(input.returnTo, redirectOrigin);
      if (
        candidate.origin === redirectOrigin &&
        !candidate.pathname.startsWith("//")
      ) {
        returnTo = `${candidate.pathname}${candidate.search}${candidate.hash}`;
      }
    }
    const now = new Date();
    await db
      .delete(outlookOAuthState)
      .where(lt(outlookOAuthState.expiresAt, now));
    await db.insert(outlookOAuthState).values({
      claimId: null,
      consumedAt: null,
      createdAt: now,
      credentialGeneration: generation,
      encryptedCodeVerifier: encryptGmailCredentialSecret(
        request.codeVerifier,
        {
          legacyKey: configuration.encryptionKey,
        }
      ),
      encryptedNonce: encryptGmailCredentialSecret(request.nonce, {
        legacyKey: configuration.encryptionKey,
      }),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      mailboxId: input.mailboxId ?? null,
      organizationId: input.organizationId,
      redirectUri: configuration.oauth.redirectUri,
      requestedScopes,
      returnTo,
      sessionHash: createHash("sha256")
        .update(session.session.id)
        .digest("hex"),
      stateHash: createHash("sha256").update(request.state).digest("hex"),
      userId: input.userId,
    });
    return { authorizationUrl: request.authorizationUrl };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
      message: "The mailbox connection could not be started. Please try again.",
    });
  }
};

export const completeOutlookOAuth = async (input: {
  code: string;
  headers: Headers;
  state: string;
}): Promise<{ mailboxId: string; returnTo: string }> => {
  try {
    if (
      !/^[\w-]{43}$/u.test(input.state) ||
      input.code.length === 0 ||
      input.code.length > 8192
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox connection request is invalid or expired.",
      });
    }
    const configuration = getOutlookMailConfiguration();
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    const session = await getSessionWithOrganization(input.headers);
    if (session?.user === undefined || session.session === undefined) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Sign in before connecting a mailbox.",
      });
    }
    const claimId = randomUUID();
    const sessionHash = createHash("sha256")
      .update(session.session.id)
      .digest("hex");
    const stateHash = createHash("sha256").update(input.state).digest("hex");
    const [attempt] = await db
      .update(outlookOAuthState)
      .set({ claimId, consumedAt: new Date() })
      .where(
        and(
          eq(outlookOAuthState.stateHash, stateHash),
          eq(outlookOAuthState.userId, session.user.id),
          eq(outlookOAuthState.sessionHash, sessionHash),
          isNull(outlookOAuthState.claimId),
          isNull(outlookOAuthState.consumedAt),
          gt(outlookOAuthState.expiresAt, new Date())
        )
      )
      .returning();
    if (attempt === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox connection request is invalid or expired.",
      });
    }
    const requested = new Set(
      attempt.requestedScopes
        .split(/\s+/u)
        .map((scope) =>
          scope
            .replace(/^https:\/\/graph\.microsoft\.com\//iu, "")
            .toLowerCase()
        )
    );
    if (
      attempt.redirectUri !== configuration.oauth.redirectUri ||
      requested.size !== 5 ||
      !["openid", "profile", "offline_access", "user.read", "mail.read"].every(
        (scope) => requested.has(scope)
      )
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox connection request is invalid or expired.",
      });
    }
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, attempt.organizationId),
          eq(member.userId, session.user.id)
        )
      )
      .limit(1);
    if (membership === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Team not found." });
    }
    if (attempt.mailboxId !== null) {
      const current = await loadOwnedOutlookCredential({
        mailboxId: attempt.mailboxId,
        userId: session.user.id,
      });
      if (
        current.organizationId !== attempt.organizationId ||
        current.credential.generation !== attempt.credentialGeneration
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This mailbox connection changed. Start the connection again.",
        });
      }
    }
    const token = await exchangeOutlookAuthorizationCode({
      code: input.code,
      codeVerifier: decryptGmailCredentialSecret(
        attempt.encryptedCodeVerifier,
        {
          legacyKey: configuration.encryptionKey,
        }
      ),
      config: configuration.oauth,
      nonce: decryptGmailCredentialSecret(attempt.encryptedNonce, {
        legacyKey: configuration.encryptionKey,
      }),
    });
    const profile = await getOutlookProfile({ accessToken: token.accessToken });
    await listOutlookMailFolders({ accessToken: token.accessToken }, {});
    const emailAddress = profile.emailAddress.trim().toLowerCase();
    const mailboxId = attempt.mailboxId ?? randomUUID();
    const now = new Date();
    await withExternalMailboxCapacity(
      {
        beforeAdmission: async (database) => {
          const [receipt] = await database
            .select({ stateHash: outlookOAuthState.stateHash })
            .from(outlookOAuthState)
            .where(
              and(
                eq(outlookOAuthState.claimId, claimId),
                eq(outlookOAuthState.organizationId, attempt.organizationId),
                eq(outlookOAuthState.sessionHash, sessionHash),
                eq(outlookOAuthState.stateHash, stateHash),
                eq(outlookOAuthState.userId, session.user.id),
                isNotNull(outlookOAuthState.consumedAt),
                gt(outlookOAuthState.expiresAt, new Date())
              )
            )
            .for("update");
          if (receipt === undefined) {
            throw new ORPCError("BAD_REQUEST", {
              message: "This mailbox connection request is invalid or expired.",
            });
          }
        },
        mailboxId: attempt.mailboxId,
        organizationId: attempt.organizationId,
        provider: "outlook",
        userId: session.user.id,
      },
      async (database) => {
        if (attempt.mailboxId !== null) {
          const [current] = await database
            .select({
              credential: outlookCredential,
              organizationId: mailbox.organizationId,
            })
            .from(outlookCredential)
            .innerJoin(mailbox, eq(mailbox.id, outlookCredential.mailboxId))
            .where(
              and(
                eq(outlookCredential.mailboxId, attempt.mailboxId),
                eq(outlookCredential.ownerUserId, session.user.id),
                eq(mailbox.ownerUserId, session.user.id),
                eq(mailbox.provider, "outlook")
              )
            )
            .for("update");
          if (
            current === undefined ||
            current.organizationId !== attempt.organizationId ||
            current.credential.generation !== attempt.credentialGeneration ||
            current.credential.issuer !== token.account.issuer ||
            current.credential.subject !== token.account.subject ||
            current.credential.graphAccountId !== profile.id
          ) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Choose the same account to reconnect this mailbox.",
            });
          }
          const [collision] = await database
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(
              and(
                sql`lower(${mailbox.emailAddress}) = ${emailAddress}`,
                sql`${mailbox.id} <> ${mailboxId}`
              )
            )
            .limit(1);
          if (collision !== undefined) {
            throw new ORPCError("BAD_REQUEST", {
              message:
                "This account cannot be connected. Choose another account or reconnect its existing mailbox.",
            });
          }
          await database
            .update(mailbox)
            .set({
              emailAddress,
              status: "connected",
              updatedAt: now,
            })
            .where(eq(mailbox.id, mailboxId));
          await database
            .update(outlookCredential)
            .set({
              accessTokenExpiresAt: token.accessTokenExpiresAt,
              encryptedAccessToken: encryptGmailCredentialSecret(
                token.accessToken,
                { legacyKey: configuration.encryptionKey }
              ),
              encryptedRefreshToken: encryptGmailCredentialSecret(
                token.refreshToken,
                { legacyKey: configuration.encryptionKey }
              ),
              generation: current.credential.generation + 1,
              scopes: token.scopes,
              status: "connected",
              updatedAt: now,
            })
            .where(eq(outlookCredential.mailboxId, mailboxId));
          await database
            .delete(outlookOAuthState)
            .where(
              and(
                eq(outlookOAuthState.claimId, claimId),
                eq(outlookOAuthState.stateHash, stateHash),
                eq(outlookOAuthState.userId, session.user.id)
              )
            );
          return;
        }
        const [accountCollision] = await database
          .select({ mailboxId: outlookCredential.mailboxId })
          .from(outlookCredential)
          .where(
            and(
              eq(outlookCredential.ownerUserId, session.user.id),
              eq(outlookCredential.issuer, token.account.issuer),
              eq(outlookCredential.subject, token.account.subject)
            )
          )
          .limit(1);
        const [addressCollision] = await database
          .select({ id: mailbox.id })
          .from(mailbox)
          .where(sql`lower(${mailbox.emailAddress}) = ${emailAddress}`)
          .limit(1);
        if (accountCollision !== undefined || addressCollision !== undefined) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "This account cannot be connected. Choose another account or reconnect its existing mailbox.",
          });
        }
        await database.insert(mailbox).values({
          accessMode: "private",
          createdAt: now,
          displayName: profile.displayName,
          divisionId: null,
          emailAddress,
          id: mailboxId,
          managedOwnerUserId: null,
          organizationId: attempt.organizationId,
          ownerUserId: session.user.id,
          provider: "outlook",
          status: "connected",
          updatedAt: now,
        });
        await database.insert(outlookCredential).values({
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          createdAt: now,
          encryptedAccessToken: encryptGmailCredentialSecret(
            token.accessToken,
            { legacyKey: configuration.encryptionKey }
          ),
          encryptedRefreshToken: encryptGmailCredentialSecret(
            token.refreshToken,
            { legacyKey: configuration.encryptionKey }
          ),
          generation: 0,
          graphAccountId: profile.id,
          issuer: token.account.issuer,
          mailboxId,
          ownerUserId: session.user.id,
          scopes: token.scopes,
          status: "connected",
          subject: token.account.subject,
          updatedAt: now,
        });
        await database
          .delete(outlookOAuthState)
          .where(
            and(
              eq(outlookOAuthState.claimId, claimId),
              eq(outlookOAuthState.stateHash, stateHash),
              eq(outlookOAuthState.userId, session.user.id)
            )
          );
      }
    );
    const { origin } = new URL(configuration.oauth.redirectUri);
    const returnUrl = new URL(attempt.returnTo, origin);
    return {
      mailboxId,
      returnTo:
        returnUrl.origin === origin && !returnUrl.pathname.startsWith("//")
          ? `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`
          : "/settings?tab=mailboxes",
    };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }
    if (error instanceof OutlookOAuthError) {
      if (error.code === "invalid_grant" || error.code === "missing_scopes") {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "The mailbox could not be connected. Start again and grant mail access.",
        });
      }
      if (error.code === "temporary") {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          cause: error,
          message:
            "The mailbox connection is temporarily unavailable. Please try again.",
        });
      }
    }
    if (error instanceof OutlookGraphError) {
      if (error.code === "unauthorized" || error.code === "forbidden") {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "The mailbox could not be connected. Start again and grant mail access.",
        });
      }
      if (error.code === "not_found" || error.code === "unsupported") {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This account does not have an available mailbox. Choose another account.",
        });
      }
      if (error.code === "rate_limited") {
        const retryAfter = Math.max(
          1,
          Math.ceil(
            ((error.retryAt?.getTime() ?? Date.now() + 1000) - Date.now()) /
              1000
          )
        );
        throw new ORPCError("RATE_LIMITED", {
          cause: error,
          data: { provider: "server", retryAfter },
          message: "Your mailbox is busy. Please try again shortly.",
        });
      }
      if (error.code === "temporary") {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          cause: error,
          message:
            "The mailbox connection is temporarily unavailable. Please try again.",
        });
      }
    }
    if (
      z.object({ code: z.literal("23505") }).safeParse(error).success ||
      z
        .object({ cause: z.object({ code: z.literal("23505") }) })
        .safeParse(error).success
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "This account cannot be connected. Choose another account or reconnect its existing mailbox.",
      });
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
      message: "The mailbox could not be connected. Please try again.",
    });
  }
};

export const disconnectOutlookMailbox = async (input: {
  mailboxId: string;
  userId: string;
}): Promise<{ disconnected: true; mailboxId: string }> => {
  try {
    await db.transaction(async (database) => {
      await database.execute(
        sql`select set_config('quieter.action_protocol', 'personal-actions-v1', true)`
      );
      await database
        .delete(outlookOAuthState)
        .where(
          and(
            eq(outlookOAuthState.userId, input.userId),
            or(
              eq(outlookOAuthState.mailboxId, input.mailboxId),
              isNull(outlookOAuthState.mailboxId)
            )
          )
        );
      await pausePersonalAgentConnections(
        { connectionIds: [input.mailboxId], userId: input.userId },
        database
      );
      const [owned] = await database
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(
          and(
            eq(mailbox.id, input.mailboxId),
            eq(mailbox.ownerUserId, input.userId),
            eq(mailbox.provider, "outlook")
          )
        )
        .for("update");
      if (owned === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
      }
      await database
        .update(outlookCredential)
        .set({
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          generation: sql`${outlookCredential.generation} + 1`,
          status: "disconnected",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outlookCredential.mailboxId, input.mailboxId),
            eq(outlookCredential.ownerUserId, input.userId)
          )
        );
      await database.delete(mailbox).where(eq(mailbox.id, input.mailboxId));
      await database
        .update(user)
        .set({ defaultMailboxId: null, updatedAt: new Date() })
        .where(
          and(
            eq(user.id, input.userId),
            eq(user.defaultMailboxId, input.mailboxId)
          )
        );
    });
    return { disconnected: true, mailboxId: input.mailboxId };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
      message: "The mailbox could not be disconnected. Please try again.",
    });
  }
};

export const getOutlookConnectionStatus = async (input: {
  mailboxId?: string;
  userId: string;
}): Promise<{
  isConfigured: boolean;
  status: "connected" | "needs_reconnect" | "not_connected";
}> => {
  let isConfigured = true;
  try {
    getOutlookMailConfiguration();
  } catch (error) {
    if (error instanceof ORPCError && error.code === "SERVICE_UNAVAILABLE") {
      isConfigured = false;
    } else {
      throw error;
    }
  }
  try {
    if (input.mailboxId === undefined) {
      return { isConfigured, status: "not_connected" };
    }
    const current = await loadOwnedOutlookCredential({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    return {
      isConfigured,
      status:
        current.credential.status === "connected" &&
        current.mailboxStatus === "connected"
          ? "connected"
          : "needs_reconnect",
    };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
      message: "The mailbox connection could not be checked. Please try again.",
    });
  }
};
