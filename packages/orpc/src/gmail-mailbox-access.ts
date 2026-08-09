import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { gmailCredential, mailbox } from "@quieter/database/schema";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { isGmailServiceError } from "@quieter/gmail";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "./gmail-credential-crypto";
import { hasText } from "./text";

export const GMAIL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://mail.google.com/",
] as const;

const GMAIL_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const permanentGoogleTokenErrors = new Set(["invalid_grant", "invalid_token"]);

const googleRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1).optional(),
  token_type: z.string().min(1),
});

const googleTokenErrorResponseSchema = z.object({
  error: z.string().optional(),
});

const getGmailOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_GMAIL_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_GMAIL_CLIENT_SECRET"),
});

export const getGmailOAuthConfig = () => {
  const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "");
  return {
    ...getGmailOAuthClient(),
    redirectUri: `${baseUrl}/api/gmail/callback`,
  };
};

const getGmailCredentialEncryptionKeys = () => ({
  currentKey: serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT,
  legacyKey: requireServerEnv("GMAIL_TOKEN_ENCRYPTION_KEY"),
});

export const encryptSecret = (value: string) =>
  encryptGmailCredentialSecret(value, getGmailCredentialEncryptionKeys());

export const decryptSecret = (value: string) =>
  decryptGmailCredentialSecret(value, getGmailCredentialEncryptionKeys());

export const rotateGmailCredentialSecrets = async <
  TRecord extends {
    encryptedAccessToken: string | null;
    encryptedRefreshToken: string | null;
    id: string;
  },
>(
  record: TRecord
) => {
  if (
    serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT === undefined ||
    serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT === "" ||
    ((!hasText(record.encryptedAccessToken) ||
      !record.encryptedAccessToken.startsWith("v1.")) &&
      (!hasText(record.encryptedRefreshToken) ||
        !record.encryptedRefreshToken.startsWith("v1.")))
  ) {
    return { record, rotated: false };
  }

  const encryptedAccessToken =
    hasText(record.encryptedAccessToken) &&
    record.encryptedAccessToken.startsWith("v1.")
      ? encryptSecret(decryptSecret(record.encryptedAccessToken))
      : record.encryptedAccessToken;
  const encryptedRefreshToken =
    hasText(record.encryptedRefreshToken) &&
    record.encryptedRefreshToken.startsWith("v1.")
      ? encryptSecret(decryptSecret(record.encryptedRefreshToken))
      : record.encryptedRefreshToken;

  const [rotatedCredential] = await db
    .update(gmailCredential)
    .set({
      encryptedAccessToken,
      encryptedRefreshToken,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gmailCredential.mailboxId, record.id),
        record.encryptedAccessToken === null
          ? isNull(gmailCredential.encryptedAccessToken)
          : eq(
              gmailCredential.encryptedAccessToken,
              record.encryptedAccessToken
            ),
        record.encryptedRefreshToken === null
          ? isNull(gmailCredential.encryptedRefreshToken)
          : eq(
              gmailCredential.encryptedRefreshToken,
              record.encryptedRefreshToken
            )
      )
    )
    .returning({ id: gmailCredential.mailboxId });

  return {
    record: {
      ...record,
      encryptedAccessToken,
      encryptedRefreshToken,
    },
    rotated: rotatedCredential !== undefined,
  };
};

const getGmailRepairRequiredError = (record: {
  emailAddress: string;
  id: string;
}) =>
  new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
    data: {
      emailAddress: record.emailAddress,
      mailboxId: record.id,
    },
    message: "Google access needs to be reconnected for this mailbox.",
    status: 409,
  });

const gmailTokenRefreshes = new Map<string, Promise<string>>();

const performGmailAccessTokenRefresh = async (record: {
  emailAddress: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  id: string;
}) => {
  if (!hasText(record.encryptedRefreshToken)) {
    await db
      .update(mailbox)
      .set({ status: "needs_reconnect", updatedAt: new Date() })
      .where(eq(mailbox.id, record.id));
    throw getGmailRepairRequiredError(record);
  }

  const config = getGmailOAuthClient();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(record.encryptedRefreshToken),
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    let errorCode: string | undefined;
    try {
      const errorBody = googleTokenErrorResponseSchema.safeParse(
        await response.json()
      );
      if (errorBody.success) {
        errorCode = errorBody.data.error;
      }
    } catch {
      errorCode = undefined;
    }
    const isPermanentAuthFailure =
      response.status === 401 ||
      (errorCode !== undefined && permanentGoogleTokenErrors.has(errorCode));

    if (isPermanentAuthFailure) {
      await db
        .update(mailbox)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(mailbox.id, record.id));
      throw getGmailRepairRequiredError(record);
    }

    throw new Error(
      `Google token refresh failed with status ${response.status}.`
    );
  }

  const refreshed = googleRefreshResponseSchema.parse(await response.json());
  const now = new Date();
  const [updatedCredential] = await db
    .update(gmailCredential)
    .set({
      accessTokenExpiresAt: new Date(
        now.getTime() + refreshed.expires_in * 1000
      ),
      encryptedAccessToken: encryptSecret(refreshed.access_token),
      scopes: refreshed.scope ?? GMAIL_SCOPES.join(" "),
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailCredential.mailboxId, record.id),
        record.encryptedAccessToken === null
          ? isNull(gmailCredential.encryptedAccessToken)
          : eq(
              gmailCredential.encryptedAccessToken,
              record.encryptedAccessToken
            )
      )
    )
    .returning({ mailboxId: gmailCredential.mailboxId });
  if (updatedCredential !== undefined) {
    await db
      .update(mailbox)
      .set({ status: "connected", updatedAt: now })
      .where(eq(mailbox.id, record.id));
    return refreshed.access_token;
  }

  const [currentCredential] = await db
    .select({
      accessTokenExpiresAt: gmailCredential.accessTokenExpiresAt,
      encryptedAccessToken: gmailCredential.encryptedAccessToken,
    })
    .from(gmailCredential)
    .where(eq(gmailCredential.mailboxId, record.id))
    .limit(1);
  if (
    hasText(currentCredential?.encryptedAccessToken) &&
    currentCredential.accessTokenExpiresAt !== null &&
    currentCredential.accessTokenExpiresAt.getTime() > Date.now()
  ) {
    return decryptSecret(currentCredential.encryptedAccessToken);
  }

  return refreshed.access_token;
};

const refreshGmailAccessToken = async (
  record: Parameters<typeof performGmailAccessTokenRefresh>[0]
) => {
  const existingRefresh = gmailTokenRefreshes.get(record.id);
  if (existingRefresh !== undefined) {
    return await existingRefresh;
  }

  const refreshPromise = (async () =>
    await performGmailAccessTokenRefresh(record))();
  gmailTokenRefreshes.set(record.id, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    if (gmailTokenRefreshes.get(record.id) === refreshPromise) {
      gmailTokenRefreshes.delete(record.id);
    }
  }
};

const getOwnedGmailCredential = async (mailboxId: string, userId: string) => {
  const [record] = await db
    .select({
      accessTokenExpiresAt: gmailCredential.accessTokenExpiresAt,
      emailAddress: mailbox.emailAddress,
      encryptedAccessToken: gmailCredential.encryptedAccessToken,
      encryptedRefreshToken: gmailCredential.encryptedRefreshToken,
      id: mailbox.id,
      status: mailbox.status,
    })
    .from(mailbox)
    .innerJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
    .where(
      and(
        eq(mailbox.id, mailboxId),
        eq(mailbox.ownerUserId, userId),
        eq(mailbox.provider, "gmail")
      )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }
  const rotated = await rotateGmailCredentialSecrets(record);
  return rotated.record;
};

export const getAuthorizedGmailMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const record = await getOwnedGmailCredential(input.mailboxId, input.userId);
  if (record.status === "needs_reconnect") {
    throw getGmailRepairRequiredError(record);
  }

  if (
    hasText(record.encryptedAccessToken) &&
    record.accessTokenExpiresAt !== null &&
    record.accessTokenExpiresAt.getTime() >
      Date.now() + GMAIL_ACCESS_TOKEN_EXPIRY_BUFFER_MS
  ) {
    return {
      accessToken: decryptSecret(record.encryptedAccessToken),
      mailbox: record,
    };
  }

  return {
    accessToken: await refreshGmailAccessToken(record),
    mailbox: record,
  };
};

export const refreshAuthorizedGmailAccessToken = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const record = await getOwnedGmailCredential(input.mailboxId, input.userId);
  return await refreshGmailAccessToken(record);
};

export const markGmailMailboxNeedsReconnect = async (mailboxId: string) => {
  await db
    .update(mailbox)
    .set({ status: "needs_reconnect", updatedAt: new Date() })
    .where(eq(mailbox.id, mailboxId));
};

const isGmailAuthError = (error: unknown) =>
  isGmailServiceError(error) &&
  error.status === 401 &&
  ((typeof error.googleReason === "string" &&
    error.googleReason.toLowerCase() === "autherror") ||
    (typeof error.googleStatus === "string" &&
      error.googleStatus.toUpperCase() === "UNAUTHENTICATED"));

export const runAuthorizedGmailMailbox = async <TValue>(
  input: { mailboxId: string; userId: string },
  runner: (accessToken: string) => Promise<TValue>
): Promise<TValue> => {
  const { accessToken, mailbox: authorizedMailbox } =
    await getAuthorizedGmailMailbox(input);

  try {
    return await runner(accessToken);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshAuthorizedGmailAccessToken(input);

  try {
    return await runner(refreshedAccessToken);
  } catch (error) {
    if (!isGmailAuthError(error)) {
      throw error;
    }

    await markGmailMailboxNeedsReconnect(authorizedMailbox.id);
    await getAuthorizedGmailMailbox(input);
    throw error;
  }
};
