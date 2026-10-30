import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { z } from "zod";

import { readBoundedJson } from "./bounded-json";
import { timingSafeEqual } from "./crypto-utils";
import { broadcastGmailUpdate } from "./mail-updates";
import { RequestError } from "./request-error";

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

export const signaturesMatch = async (actual: string, expected: string) => {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(actual)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected)),
  ]);
  return timingSafeEqual(actualDigest, expectedDigest);
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

export const handlePubSub = async (
  request: Request,
  env: Env,
  processNotification: (
    message: {
      emailAddress: string;
      historyId: string;
      pubSubMessageId: string;
    },
    bindings: Env
  ) => Promise<unknown> = async (message, _bindings) => {
    const { withRequestDatabaseClient } =
      await import("@quieter/database/client");
    const { processGmailPubSubNotification } =
      await import("@quieter/orpc/gmail-pubsub");
    const result = await withRequestDatabaseClient(
      async () => await processGmailPubSubNotification(message)
    );
    return {
      retry:
        !result.ignored &&
        (result.busy === true || result.needsContinuation === true),
    };
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
  };
  const processing = await processNotification(processorMessage, env);
  await broadcastGmailUpdate(
    env,
    emailAddress,
    "mailbox.changed",
    notification.historyId
  );
  if (
    typeof processing === "object" &&
    processing !== null &&
    "retry" in processing &&
    processing.retry === true
  ) {
    return Response.json({ error: "Processing pending" }, { status: 503 });
  }
  return new Response(null, { status: 204 });
};

export { readBoundedJson } from "./bounded-json";

export { requestErrorResponse } from "./request-error";
