import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const ticketSchema = z.object({
  expiresAt: z.number().int(),
  issuedAt: z.number().int(),
  nonce: z.uuid(),
  purpose: z.literal("mail-sync-connect"),
  sessionId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
});

export const createSyncTicket = (
  userId: string,
  sessionId: string,
  secret: string,
  now = Date.now()
) => {
  if (secret.length < 32) {
    throw new Error("Mail sync requires a strong signing secret.");
  }
  const payload = Buffer.from(
    JSON.stringify({
      expiresAt: now + 90_000,
      issuedAt: now,
      nonce: crypto.randomUUID(),
      purpose: "mail-sync-connect",
      sessionId,
      userId,
    })
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};

export const verifySyncTicket = (
  ticket: string,
  secret: string,
  now = Date.now()
) => {
  if (ticket.length > 2048 || secret.length < 32) {
    throw new Error("Invalid sync ticket.");
  }
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra !== undefined) {
    throw new Error("Invalid sync ticket.");
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid sync ticket.");
  }
  const claims = ticketSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
  );
  if (
    claims.expiresAt <= now ||
    claims.issuedAt > now + 30_000 ||
    claims.expiresAt - claims.issuedAt > 90_000
  ) {
    throw new Error("Sync ticket expired.");
  }
  return claims;
};

export const verifySyncInternalRequest = (
  authorization: string | null,
  secret: string
) => {
  if (secret.length < 32 || authorization === null) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`Bearer ${secret}`)
    .digest();
  const actual = createHmac("sha256", secret).update(authorization).digest();
  return timingSafeEqual(actual, expected);
};
