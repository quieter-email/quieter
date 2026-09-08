import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { liveSyncTokenPayloadSchema } from "@quieter/mail/live-sync";
import type { z } from "zod";

const TOKEN_LIFETIME_SECONDS = 90;

export type GmailLiveSyncTokenPayload = z.infer<
  typeof liveSyncTokenPayloadSchema
>;

const signTokenPayload = (encodedPayload: string, secret: string) =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const createGmailLiveSyncToken = (
  input: {
    emailAddress: string;
    mailboxId: string;
    userId: string;
  },
  secret: string,
  now = new Date()
) => {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: GmailLiveSyncTokenPayload = {
    emailAddress: input.emailAddress.trim().toLowerCase(),
    expiresAt: issuedAt + TOKEN_LIFETIME_SECONDS,
    issuedAt,
    mailboxId: input.mailboxId,
    nonce: randomUUID(),
    userId: input.userId,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );

  return {
    expiresAt: new Date(payload.expiresAt * 1000),
    token: `${encodedPayload}.${signTokenPayload(encodedPayload, secret)}`,
  };
};

export const verifyGmailLiveSyncToken = (
  token: string,
  secret: string,
  now = new Date()
): GmailLiveSyncTokenPayload => {
  const [encodedPayload, encodedSignature, extraPart] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraPart !== undefined) {
    throw new Error("Gmail live-sync token is malformed.");
  }

  const expectedSignature = Buffer.from(
    signTokenPayload(encodedPayload, secret)
  );
  const providedSignature = Buffer.from(encodedSignature);
  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error("Gmail live-sync token signature is invalid.");
  }

  const payload = liveSyncTokenPayloadSchema.parse(
    JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8"))
  );
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (payload.expiresAt <= nowSeconds || payload.issuedAt > nowSeconds + 30) {
    throw new Error("Gmail live-sync token is expired or not active.");
  }

  return payload;
};
