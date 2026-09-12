import { liveSyncTokenPayloadSchema } from "@quieter/mail/live-sync";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { z } from "zod";

import { readBoundedJson } from "./bounded-json";
import { timingSafeEqual } from "./crypto-utils";
import { broadcastGmailUpdate } from "./mail-updates";
import { RequestError } from "./request-error";
import { readLinkedSecret, reportWorkerError } from "./worker-runtime";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);
const PUBSUB_BODY_LIMIT = 64 * 1024;
const textEncoder = new TextEncoder();
const pubSubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().min(1),
  }),
  subscription: z.string().min(1),
});

const gmailNotificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z
    .union([
      z.string().regex(/^\d+$/u),
      z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .transform(String),
    ])
    .pipe(z.string().min(1)),
});

const pubSubJwtPayloadSchema = z.object({
  email: z.string(),
  email_verified: z.literal(true),
});

const decodeBase64Url = (value: string) => {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
};

const encodeBase64Url = (value: ArrayBuffer) => {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const signTokenPayload = async (encodedPayload: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  return encodeBase64Url(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload))
  );
};

export const signaturesMatch = async (actual: string, expected: string) => {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(actual)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected)),
  ]);
  return timingSafeEqual(actualDigest, expectedDigest);
};

export const verifyLiveSyncToken = async (token: string, secret: string) => {
  const [encodedPayload, encodedSignature, extraPart] = token.split(".");
  if (
    encodedPayload === undefined ||
    encodedPayload === "" ||
    encodedSignature === undefined ||
    encodedSignature === "" ||
    extraPart !== undefined
  ) {
    throw new RequestError(401, "live_sync_token_malformed");
  }

  const expectedSignature = await signTokenPayload(encodedPayload, secret);
  if (!(await signaturesMatch(encodedSignature, expectedSignature))) {
    throw new RequestError(401, "live_sync_token_signature_invalid");
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(decodeBase64Url(encodedPayload));
  } catch {
    parsedPayload = undefined;
  }

  const payload = liveSyncTokenPayloadSchema.safeParse(parsedPayload);
  if (!payload.success) {
    throw new RequestError(401, "live_sync_token_payload_invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    payload.data.expiresAt <= nowSeconds ||
    payload.data.issuedAt > nowSeconds + 30
  ) {
    throw new RequestError(401, "live_sync_token_inactive");
  }
  return payload.data;
};

export const verifyPubSubToken = async (request: Request, env: Env) => {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(?<token>.+)$/iu)?.groups
    ?.token;
  if (token === undefined || token === "") {
    throw new RequestError(401, "pubsub_bearer_missing");
  }

  let verifiedPayload: z.infer<typeof pubSubJwtPayloadSchema>;
  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      audience: env.GMAIL_PUBSUB_PUSH_AUDIENCE,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
    });
    const parsedPayload = pubSubJwtPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      throw new RequestError(403, "pubsub_service_account_invalid");
    }
    verifiedPayload = parsedPayload.data;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    if (error instanceof joseErrors.JWKSTimeout) {
      throw new RequestError(503, "pubsub_jwks_unavailable");
    }
    if (error instanceof joseErrors.JOSEError) {
      throw new RequestError(401, "pubsub_bearer_invalid");
    }
    throw error;
  }
  if (
    verifiedPayload.email.toLowerCase() !==
    env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT.toLowerCase()
  ) {
    throw new RequestError(403, "pubsub_service_account_invalid");
  }
};

export const parseGmailNotification = (data: string) => {
  try {
    return gmailNotificationSchema.parse(JSON.parse(decodeBase64Url(data)));
  } catch {
    throw new RequestError(400, "pubsub_notification_invalid");
  }
};

export const mailboxObject = (env: Env, emailAddress: string) => {
  const id = env.GmailLiveSyncMailboxV2.idFromName(
    emailAddress.trim().toLowerCase()
  );
  return env.GmailLiveSyncMailboxV2.get(id);
};

const broadcastMailboxEvent = async (
  env: Env,
  emailAddress: string,
  type: "mailbox-details-dirty" | "mailbox-dirty"
) => {
  const response = await mailboxObject(env, emailAddress).fetch(
    "https://internal.quieter/broadcast",
    {
      body: JSON.stringify({ type }),
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new RequestError(503, "broadcast_response_error");
  }
};

export const handleLiveMailboxRequest = async (request: Request, env: Env) => {
  const token = new URL(request.url).searchParams.get("token");
  if (token === null || token === "") {
    throw new RequestError(401, "live_sync_token_missing");
  }

  const payload = await verifyLiveSyncToken(
    token,
    readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret)
  );
  return await mailboxObject(env, payload.emailAddress).fetch(request);
};

export const handlePubSub = async (
  request: Request,
  env: Env,
  processNotification = async (message: unknown, bindings: Env) => {
    await bindings.GmailPsQueue.send(message);
  }
) => {
  await verifyPubSubToken(request, env);
  const envelope = pubSubEnvelopeSchema.safeParse(
    await readBoundedJson(request, PUBSUB_BODY_LIMIT)
  );
  if (!envelope.success) {
    throw new RequestError(400, "pubsub_envelope_invalid");
  }
  if (envelope.data.subscription !== env.GMAIL_PUBSUB_SUBSCRIPTION) {
    throw new RequestError(403, "pubsub_subscription_invalid");
  }

  const notification = parseGmailNotification(envelope.data.message.data);
  const emailAddress = notification.emailAddress.trim().toLowerCase();
  const processorMessage = {
    emailAddress,
    historyId: notification.historyId,
    pubSubMessageId: envelope.data.message.messageId,
    type: "notification" as const,
  };
  await processNotification(processorMessage, env);
  const broadcasts = await Promise.allSettled([
    broadcastMailboxEvent(env, emailAddress, "mailbox-dirty"),
    broadcastGmailUpdate(env, emailAddress, "mailbox.changed"),
  ]);
  for (const result of broadcasts) {
    if (result.status === "rejected") {
      reportWorkerError(result.reason, {
        category: "mail_broadcast_error",
        route: "pubsub",
      });
    }
  }
  return new Response(null, { status: 204 });
};

export { readBoundedJson } from "./bounded-json";

export { requestErrorResponse } from "./request-error";
