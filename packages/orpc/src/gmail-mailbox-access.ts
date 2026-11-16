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

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist",
] as const;

export const GMAIL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  ...CALENDAR_SCOPES,
] as const;

/**
 * The broad Gmail scope grants every Gmail API operation, so the granular
 * gmail.modify scope is requested for clarity but not required back from
 * Google, which may normalize overlapping scopes in its token response.
 */
export const REQUIRED_GMAIL_SCOPES = [
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
    googleSubject: string;
    id: string;
  },
>(
  record: TRecord
) => {
  if (
    serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT === undefined ||
    serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT === "" ||
    ((!record.encryptedAccessToken ||
      !record.encryptedAccessToken.startsWith("v1.")) &&
      (!record.encryptedRefreshToken ||
        !record.encryptedRefreshToken.startsWith("v1.")))
  ) {
    return { record, rotated: false };
  }

  const encryptedAccessToken =
    record.encryptedAccessToken && record.encryptedAccessToken.startsWith("v1.")
      ? encryptSecret(decryptSecret(record.encryptedAccessToken))
      : record.encryptedAccessToken;
  const encryptedRefreshToken =
    record.encryptedRefreshToken &&
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
        eq(gmailCredential.googleSubject, record.googleSubject),
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

type GmailAccessTokenCredential = Readonly<
  Pick<
    typeof gmailCredential.$inferSelect,
    "encryptedAccessToken" | "encryptedRefreshToken" | "googleSubject"
  > & { id: string }
>;

type PreparedGmailAccessToken = Readonly<{
  accessToken: string;
  markNeedsReconnect: () => Promise<void>;
}>;

const setGmailMailboxStatusForCredential = async (input: {
  record: GmailAccessTokenCredential;
  status: "connected" | "needs_reconnect";
  updatedAt?: Date;
}) => {
  await db.transaction(async (tx) => {
    const [currentMailbox] = await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.record.id))
      .limit(1)
      .for("update");
    if (currentMailbox === undefined) {
      return;
    }

    const [currentCredential] = await tx
      .select({
        encryptedAccessToken: gmailCredential.encryptedAccessToken,
        encryptedRefreshToken: gmailCredential.encryptedRefreshToken,
        googleSubject: gmailCredential.googleSubject,
      })
      .from(gmailCredential)
      .where(eq(gmailCredential.mailboxId, input.record.id))
      .limit(1)
      .for("no key update");
    if (
      currentCredential === undefined ||
      currentCredential.googleSubject !== input.record.googleSubject ||
      currentCredential.encryptedAccessToken !==
        input.record.encryptedAccessToken ||
      currentCredential.encryptedRefreshToken !==
        input.record.encryptedRefreshToken
    ) {
      return;
    }

    await tx
      .update(mailbox)
      .set({
        status: input.status,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(mailbox.id, input.record.id));
  });
};

const prepareGmailAccessToken = (
  record: GmailAccessTokenCredential,
  accessToken: string
): PreparedGmailAccessToken => ({
  accessToken,
  markNeedsReconnect: async () => {
    await setGmailMailboxStatusForCredential({
      record,
      status: "needs_reconnect",
    });
  },
});

const gmailTokenRefreshes = new Map<
  string,
  Promise<PreparedGmailAccessToken>
>();

const performGmailAccessTokenRefresh = async (record: {
  emailAddress: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  googleSubject: string;
  id: string;
  scopes: string;
}) => {
  if (!record.encryptedRefreshToken) {
    await setGmailMailboxStatusForCredential({
      record,
      status: "needs_reconnect",
    });
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
      await setGmailMailboxStatusForCredential({
        record,
        status: "needs_reconnect",
      });
      throw getGmailRepairRequiredError(record);
    }

    throw new Error(
      `Google token refresh failed with status ${response.status}.`
    );
  }

  const refreshed = googleRefreshResponseSchema.parse(await response.json());
  const now = new Date();
  const encryptedAccessToken = encryptSecret(refreshed.access_token);
  const [updatedCredential] = await db
    .update(gmailCredential)
    .set({
      accessTokenExpiresAt: new Date(
        now.getTime() + refreshed.expires_in * 1000
      ),
      encryptedAccessToken,
      scopes: refreshed.scope ?? record.scopes,
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailCredential.mailboxId, record.id),
        eq(gmailCredential.googleSubject, record.googleSubject),
        eq(gmailCredential.encryptedRefreshToken, record.encryptedRefreshToken),
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
    await setGmailMailboxStatusForCredential({
      record: { ...record, encryptedAccessToken },
      status: "connected",
      updatedAt: now,
    });
    return prepareGmailAccessToken(
      { ...record, encryptedAccessToken },
      refreshed.access_token
    );
  }

  const [currentCredential] = await db
    .select({
      accessTokenExpiresAt: gmailCredential.accessTokenExpiresAt,
      encryptedAccessToken: gmailCredential.encryptedAccessToken,
      encryptedRefreshToken: gmailCredential.encryptedRefreshToken,
    })
    .from(gmailCredential)
    .where(
      and(
        eq(gmailCredential.mailboxId, record.id),
        eq(gmailCredential.googleSubject, record.googleSubject)
      )
    )
    .limit(1);
  if (currentCredential === undefined) {
    throw new ORPCError("UNAUTHORIZED", {
      message:
        "Your inbox connection changed. Start a new request to continue.",
    });
  }
  if (
    currentCredential?.encryptedAccessToken &&
    currentCredential.accessTokenExpiresAt !== null &&
    currentCredential.accessTokenExpiresAt.getTime() > Date.now()
  ) {
    return prepareGmailAccessToken(
      { ...record, ...currentCredential },
      decryptSecret(currentCredential.encryptedAccessToken)
    );
  }

  return prepareGmailAccessToken(
    { ...record, encryptedAccessToken },
    refreshed.access_token
  );
};

const refreshGmailAccessToken = async (
  record: Parameters<typeof performGmailAccessTokenRefresh>[0]
) => {
  const refreshKey = JSON.stringify([record.id, record.googleSubject]);
  const existingRefresh = gmailTokenRefreshes.get(refreshKey);
  if (existingRefresh !== undefined) {
    return await existingRefresh;
  }

  const refreshPromise = (async () =>
    await performGmailAccessTokenRefresh(record))();
  gmailTokenRefreshes.set(refreshKey, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    if (gmailTokenRefreshes.get(refreshKey) === refreshPromise) {
      gmailTokenRefreshes.delete(refreshKey);
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
      googleSubject: gmailCredential.googleSubject,
      id: mailbox.id,
      scopes: gmailCredential.scopes,
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
    record.encryptedAccessToken &&
    record.accessTokenExpiresAt !== null &&
    record.accessTokenExpiresAt.getTime() >
      Date.now() + GMAIL_ACCESS_TOKEN_EXPIRY_BUFFER_MS
  ) {
    return {
      ...prepareGmailAccessToken(
        record,
        decryptSecret(record.encryptedAccessToken)
      ),
      mailbox: record,
    };
  }

  return {
    ...(await refreshGmailAccessToken(record)),
    mailbox: record,
  };
};

export const refreshAuthorizedGmailAccessToken = async (input: {
  gmailIdentity?: PreparedGmailMailboxIdentity;
  mailboxId: string;
  userId: string;
}) => {
  const record = await getOwnedGmailCredential(input.mailboxId, input.userId);
  if (
    input.gmailIdentity !== undefined &&
    (input.gmailIdentity.mailboxId !== record.id ||
      input.gmailIdentity.googleSubject !== record.googleSubject)
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message:
        "Your inbox connection changed. Start a new request to continue.",
    });
  }
  return await refreshGmailAccessToken(record);
};

const isGmailAuthError = (error: unknown) =>
  isGmailServiceError(error) &&
  error.status === 401 &&
  ((typeof error.googleReason === "string" &&
    error.googleReason.toLowerCase() === "autherror") ||
    (typeof error.googleStatus === "string" &&
      error.googleStatus.toUpperCase() === "UNAUTHENTICATED"));

export type PreparedGmailMailboxIdentity = Readonly<{
  googleSubject: string;
  mailboxId: string;
}>;

export const runAuthorizedGmailMailbox = async <TValue>(
  input: {
    isUnauthorized?: (error: unknown) => boolean;
    mailboxId: string;
    retryUnauthorized?: boolean;
    userId: string;
  },
  runner: (
    accessToken: string,
    identity: PreparedGmailMailboxIdentity
  ) => Promise<TValue>
): Promise<TValue> => {
  const isUnauthorized = input.isUnauthorized ?? isGmailAuthError;
  const { accessToken, mailbox: authorizedMailbox } =
    await getAuthorizedGmailMailbox(input);
  const identity: PreparedGmailMailboxIdentity = {
    googleSubject: authorizedMailbox.googleSubject,
    mailboxId: authorizedMailbox.id,
  };

  try {
    return await runner(accessToken, identity);
  } catch (error) {
    if (input.retryUnauthorized === false || !isUnauthorized(error)) {
      throw error;
    }
  }

  const refreshed = await refreshAuthorizedGmailAccessToken({
    ...input,
    gmailIdentity: identity,
  });

  try {
    return await runner(refreshed.accessToken, identity);
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }

    await refreshed.markNeedsReconnect();
    await getAuthorizedGmailMailbox(input);
    throw error;
  }
};
