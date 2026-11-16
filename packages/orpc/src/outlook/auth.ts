import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import { mailbox, member, outlookCredential } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { OutlookGraphError } from "@quieter/outlook/graph";
import type { OutlookReadContext } from "@quieter/outlook/graph";
import {
  OutlookOAuthError,
  refreshOutlookAccessToken,
} from "@quieter/outlook/oauth";
import type { OutlookOAuthConfig } from "@quieter/outlook/oauth";
import { and, eq, sql } from "drizzle-orm";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";

type OutlookAuthorizationInput = {
  expectedGeneration?: number;
  mailboxId: string;
  signal?: AbortSignal;
  userId: string;
};

type OutlookAuthorization =
  | {
      accessToken: string;
      credential: typeof outlookCredential.$inferSelect;
      kind: "authorized";
    }
  | { kind: "needs_reconnect" };

export type AuthorizedOutlookIdentity = Pick<
  typeof outlookCredential.$inferSelect,
  | "generation"
  | "graphAccountId"
  | "issuer"
  | "mailboxId"
  | "ownerUserId"
  | "subject"
>;

export const getOutlookMailConfiguration = (): {
  encryptionKey: string;
  oauth: OutlookOAuthConfig;
} => {
  const clientId = serverEnv.OUTLOOK_MAIL_CLIENT_ID;
  const clientSecret = serverEnv.OUTLOOK_MAIL_CLIENT_SECRET;
  const encryptionKey = serverEnv.OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY;
  const baseUrl = serverEnv.BETTER_AUTH_URL;
  if (!clientId || !clientSecret || !encryptionKey || !baseUrl) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Mail connections are not available. Please try again later.",
    });
  }
  const origin = URL.canParse(baseUrl) ? new URL(baseUrl) : undefined;
  if (
    origin === undefined ||
    origin.username ||
    origin.password ||
    origin.hash ||
    origin.search ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname)
      ))
  ) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Mail connections are not available. Please try again later.",
    });
  }
  return {
    encryptionKey,
    oauth: {
      clientId,
      clientSecret,
      redirectUri: new URL("/api/outlook/callback", origin.origin).href,
    },
  };
};

export const loadOwnedOutlookCredential = async (
  input: Pick<OutlookAuthorizationInput, "mailboxId" | "userId">,
  database: DatabaseExecutor = db
) => {
  const [record] = await database
    .select({
      credential: outlookCredential,
      mailboxStatus: mailbox.status,
      organizationId: mailbox.organizationId,
    })
    .from(outlookCredential)
    .innerJoin(
      mailbox,
      and(
        eq(mailbox.id, outlookCredential.mailboxId),
        eq(mailbox.ownerUserId, outlookCredential.ownerUserId)
      )
    )
    .innerJoin(
      member,
      and(
        eq(member.organizationId, mailbox.organizationId),
        eq(member.userId, input.userId)
      )
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, "outlook"),
        eq(outlookCredential.ownerUserId, input.userId)
      )
    )
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  return record;
};

const markReconnectRequired = async (
  input: Pick<OutlookAuthorizationInput, "mailboxId" | "userId"> & {
    generation: number;
  }
) => {
  await db.transaction(async (database) => {
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
      return;
    }
    const changed = await database
      .update(outlookCredential)
      .set({
        encryptedAccessToken: null,
        generation: sql`${outlookCredential.generation} + 1`,
        status: "needs_reconnect",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outlookCredential.mailboxId, input.mailboxId),
          eq(outlookCredential.ownerUserId, input.userId),
          eq(outlookCredential.generation, input.generation),
          eq(outlookCredential.status, "connected")
        )
      )
      .returning({ mailboxId: outlookCredential.mailboxId });
    if (changed.length > 0) {
      await database
        .update(mailbox)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(mailbox.id, input.mailboxId));
    }
  });
};

const getAuthorizedToken = async (
  input: OutlookAuthorizationInput,
  rejectedToken?: string
): Promise<OutlookAuthorization> => {
  input.signal?.throwIfAborted();
  const { encryptionKey, oauth } = getOutlookMailConfiguration();
  return await db.transaction(async (database) => {
    const [owned] = await database
      .select({
        organizationId: mailbox.organizationId,
        status: mailbox.status,
      })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.id, input.mailboxId),
          eq(mailbox.ownerUserId, input.userId),
          eq(mailbox.provider, "outlook")
        )
      )
      .for("update");
    const [record] = await database
      .select()
      .from(outlookCredential)
      .where(
        and(
          eq(outlookCredential.mailboxId, input.mailboxId),
          eq(outlookCredential.ownerUserId, input.userId)
        )
      )
      .for("update");
    if (owned === undefined || record === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    const [membership] = await database
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, owned.organizationId),
          eq(member.userId, input.userId)
        )
      )
      .limit(1);
    if (membership === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    if (
      input.expectedGeneration !== undefined &&
      record.generation !== input.expectedGeneration
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox connection changed. Refresh and try again.",
      });
    }
    if (record.status !== "connected" || owned.status !== "connected") {
      return { kind: "needs_reconnect" };
    }
    const scopes = new Set(
      record.scopes
        .split(/\s+/u)
        .map((scope) =>
          scope
            .replace(/^https:\/\/graph\.microsoft\.com\//iu, "")
            .toLowerCase()
        )
    );
    const validScopes = scopes.has("user.read") && scopes.has("mail.read");
    let accessToken =
      record.encryptedAccessToken === null
        ? undefined
        : decryptGmailCredentialSecret(record.encryptedAccessToken, {
            legacyKey: encryptionKey,
          });
    if (
      validScopes &&
      accessToken !== undefined &&
      accessToken !== rejectedToken &&
      record.accessTokenExpiresAt !== null &&
      record.accessTokenExpiresAt.getTime() > Date.now() + 60_000
    ) {
      return { accessToken, credential: record, kind: "authorized" };
    }
    let replacement:
      | Awaited<ReturnType<typeof refreshOutlookAccessToken>>
      | undefined;
    if (validScopes && record.encryptedRefreshToken !== null) {
      try {
        replacement = await refreshOutlookAccessToken({
          config: oauth,
          refreshToken: decryptGmailCredentialSecret(
            record.encryptedRefreshToken,
            {
              legacyKey: encryptionKey,
            }
          ),
          signal: input.signal,
        });
      } catch (error) {
        if (
          !(error instanceof OutlookOAuthError) ||
          !["invalid_grant", "missing_scopes"].includes(error.code)
        ) {
          throw error;
        }
      }
    }
    if (replacement === undefined) {
      await database
        .update(outlookCredential)
        .set({
          encryptedAccessToken: null,
          generation: record.generation + 1,
          status: "needs_reconnect",
          updatedAt: new Date(),
        })
        .where(eq(outlookCredential.mailboxId, input.mailboxId));
      await database
        .update(mailbox)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(mailbox.id, input.mailboxId));
      return { kind: "needs_reconnect" };
    }
    ({ accessToken } = replacement);
    const [updated] = await database
      .update(outlookCredential)
      .set({
        accessTokenExpiresAt: replacement.accessTokenExpiresAt,
        encryptedAccessToken: encryptGmailCredentialSecret(accessToken, {
          legacyKey: encryptionKey,
        }),
        encryptedRefreshToken:
          replacement.refreshToken === undefined
            ? record.encryptedRefreshToken
            : encryptGmailCredentialSecret(replacement.refreshToken, {
                legacyKey: encryptionKey,
              }),
        scopes: replacement.scopes,
        updatedAt: new Date(),
      })
      .where(eq(outlookCredential.mailboxId, input.mailboxId))
      .returning();
    if (updated === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    return { accessToken, credential: updated, kind: "authorized" };
  });
};

export const runAuthorizedOutlookMailbox = async <Result>(
  input: OutlookAuthorizationInput,
  operation: (
    context: OutlookReadContext,
    identity: AuthorizedOutlookIdentity
  ) => Promise<Result>
): Promise<Result> => {
  try {
    let authorization = await getAuthorizedToken(input);
    if (authorization.kind !== "authorized") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Reconnect this mailbox before using it.",
      });
    }
    const run = async (
      current: Extract<OutlookAuthorization, { kind: "authorized" }>
    ) => {
      const { credential } = current;
      let result: Result;
      try {
        result = await operation(
          { accessToken: current.accessToken, signal: input.signal },
          {
            generation: credential.generation,
            graphAccountId: credential.graphAccountId,
            issuer: credential.issuer,
            mailboxId: credential.mailboxId,
            ownerUserId: credential.ownerUserId,
            subject: credential.subject,
          }
        );
      } catch (error) {
        if (error instanceof OutlookGraphError && error.code === "forbidden") {
          await markReconnectRequired({
            generation: credential.generation,
            mailboxId: input.mailboxId,
            userId: input.userId,
          });
        }
        throw error;
      }
      input.signal?.throwIfAborted();
      const latest = await loadOwnedOutlookCredential(input);
      if (
        latest.credential.generation !== credential.generation ||
        latest.credential.status !== "connected" ||
        latest.mailboxStatus !== "connected"
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This mailbox connection changed. Refresh and try again.",
        });
      }
      return result;
    };
    try {
      return await run(authorization);
    } catch (error) {
      if (
        !(error instanceof OutlookGraphError) ||
        error.code !== "unauthorized"
      ) {
        throw error;
      }
    }
    authorization = await getAuthorizedToken(
      { ...input, expectedGeneration: authorization.credential.generation },
      authorization.accessToken
    );
    if (authorization.kind !== "authorized") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Reconnect this mailbox before using it.",
      });
    }
    try {
      return await run(authorization);
    } catch (error) {
      if (error instanceof OutlookGraphError && error.code === "unauthorized") {
        await markReconnectRequired({
          generation: authorization.credential.generation,
          mailboxId: input.mailboxId,
          userId: input.userId,
        });
        throw new ORPCError("BAD_REQUEST", {
          message: "Reconnect this mailbox before using it.",
        });
      }
      throw error;
    }
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof ORPCError) {
      throw error;
    }
    if (error instanceof OutlookGraphError) {
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
      if (error.code === "forbidden") {
        throw new ORPCError("FORBIDDEN", {
          message:
            "This mailbox is not available. Reconnect it or choose another account.",
        });
      }
      if (error.code === "not_found") {
        throw new ORPCError("NOT_FOUND", {
          message: "This mail item is no longer available.",
        });
      }
      if (error.code === "unsupported" || error.code === "invalid_cursor") {
        throw new ORPCError("BAD_REQUEST", {
          message: "This mail request is not supported. Refresh and try again.",
        });
      }
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
      message: "The mailbox could not be read. Please try again.",
    });
  }
};
