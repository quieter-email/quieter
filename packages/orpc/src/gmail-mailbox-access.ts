import { ORPCError } from "@orpc/server";
import { db, gmailCredential, mailbox } from "@quieter/database";
import { and, eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

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

const getRequiredEnvironmentValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is missing.`);
  }
  return value;
};

export const getGmailOAuthConfig = () => {
  const baseUrl = getRequiredEnvironmentValue("BETTER_AUTH_URL").replace(/\/+$/, "");
  return {
    clientId: getRequiredEnvironmentValue("GOOGLE_GMAIL_CLIENT_ID"),
    clientSecret: getRequiredEnvironmentValue("GOOGLE_GMAIL_CLIENT_SECRET"),
    redirectUri: `${baseUrl}/api/gmail/callback`,
  };
};

const getEncryptionKey = () =>
  createHash("sha256").update(getRequiredEnvironmentValue("GMAIL_TOKEN_ENCRYPTION_KEY")).digest();

export const encryptSecret = (value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

export const decryptSecret = (value: string) => {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Stored Gmail credential is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const getGmailRepairRequiredError = (record: { emailAddress: string; id: string }) =>
  new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
    data: {
      emailAddress: record.emailAddress,
      mailboxId: record.id,
    },
    message: "Google access needs to be reconnected for this mailbox.",
    status: 409,
  });

const refreshGmailAccessToken = async (record: {
  emailAddress: string;
  encryptedRefreshToken: string | null;
  id: string;
}) => {
  if (!record.encryptedRefreshToken) {
    throw getGmailRepairRequiredError(record);
  }

  const config = getGmailOAuthConfig();
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
    const errorBody = await response
      .json()
      .then((body: unknown) => googleTokenErrorResponseSchema.safeParse(body))
      .catch(() => null);
    const errorCode = errorBody?.success ? errorBody.data.error : undefined;
    const isPermanentAuthFailure =
      response.status === 400 ||
      response.status === 401 ||
      (errorCode != null && permanentGoogleTokenErrors.has(errorCode));

    if (isPermanentAuthFailure) {
      await db
        .update(mailbox)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(mailbox.id, record.id));
      throw getGmailRepairRequiredError(record);
    }

    throw new Error(`Google token refresh failed with status ${response.status}.`);
  }

  const refreshed = googleRefreshResponseSchema.parse(await response.json());
  const now = new Date();
  await db
    .update(gmailCredential)
    .set({
      accessTokenExpiresAt: new Date(now.getTime() + refreshed.expires_in * 1000),
      encryptedAccessToken: encryptSecret(refreshed.access_token),
      scopes: refreshed.scope ?? GMAIL_SCOPES.join(" "),
      updatedAt: now,
    })
    .where(eq(gmailCredential.mailboxId, record.id));
  await db
    .update(mailbox)
    .set({ status: "connected", updatedAt: now })
    .where(eq(mailbox.id, record.id));
  return refreshed.access_token;
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
        eq(mailbox.provider, "gmail"),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }
  return record;
};

export const getAuthorizedGmailMailbox = async (input: { mailboxId: string; userId: string }) => {
  const record = await getOwnedGmailCredential(input.mailboxId, input.userId);
  if (record.status === "needs_reconnect") {
    throw getGmailRepairRequiredError(record);
  }

  if (
    record.encryptedAccessToken &&
    record.accessTokenExpiresAt &&
    record.accessTokenExpiresAt.getTime() > Date.now() + GMAIL_ACCESS_TOKEN_EXPIRY_BUFFER_MS
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
