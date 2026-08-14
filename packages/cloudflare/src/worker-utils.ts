import {
  configureErrorReporter,
  reportError as reportRuntimeError,
} from "@quieter/observability";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { z } from "zod";

import { timingSafeEqual } from "./crypto-utils";
import { RequestError } from "./request-error";

export { reportError as reportWorkerError } from "@quieter/observability";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);
const PUBSUB_BODY_LIMIT = 64 * 1024;
const textEncoder = new TextEncoder();
const runtimeReportError = globalThis as typeof globalThis & {
  reportError?: (error: unknown) => void;
};

configureErrorReporter((error) => {
  runtimeReportError.reportError?.(error);
});

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

const tokenPayloadSchema = z.object({
  emailAddress: z.email(),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  mailboxId: z.string().min(1),
  nonce: z.uuid(),
  userId: z.string().min(1),
  version: z.literal(1),
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

  const payload = tokenPayloadSchema.safeParse(parsedPayload);
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

export const readLinkedSecret = (value: string) =>
  z.object({ value: z.string().min(1) }).parse(JSON.parse(value)).value;

export const readBoundedJson = async (request: Request, limit: number) => {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new RequestError(413, "request_body_too_large");
  }
  if (request.body === null) {
    throw new RequestError(400, "request_body_missing");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];

  const readChunks = async (length: number): Promise<number> => {
    const readResult = await reader.read();
    if (readResult.done) {
      return length;
    }
    const value: unknown = readResult.value;
    if (!(value instanceof Uint8Array)) {
      return await readChunks(length);
    }
    const nextLength = length + value.byteLength;
    if (nextLength > limit) {
      await reader.cancel();
      throw new RequestError(413, "request_body_too_large");
    }
    chunks.push(value);
    return await readChunks(nextLength);
  };

  let length = 0;
  try {
    length = await readChunks(length);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new RequestError(400, "request_json_invalid");
  }
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
  const id = env.GmailLiveSyncMailbox.idFromName(
    emailAddress.trim().toLowerCase()
  );
  return env.GmailLiveSyncMailbox.get(id);
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

export const handlePubSub = async (request: Request, env: Env) => {
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
  const broadcastResponse = await mailboxObject(env, emailAddress).fetch(
    "https://internal.quieter/broadcast",
    {
      body: JSON.stringify({ type: "mailbox-dirty" }),
      method: "POST",
    }
  );
  if (!broadcastResponse.ok) {
    throw new Error("Durable Object broadcast failed.");
  }

  const queueMessage = {
    emailAddress,
    historyId: notification.historyId,
    pubSubMessageId: envelope.data.message.messageId,
    type: "notification" as const,
  };
  await env.GmailPsQueue.send(queueMessage);
  return new Response(null, { status: 204 });
};

export const requestErrorResponse = (error: unknown, route: string) => {
  const status = error instanceof RequestError ? error.status : 500;
  const category =
    error instanceof RequestError ? error.category : "internal_error";
  if (status >= 500) {
    reportRuntimeError(error, { category, route, status });
  }
  return Response.json({ error: "Request failed" }, { status });
};
