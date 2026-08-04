import { DurableObject } from "cloudflare:workers";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { z } from "zod";

type GmailPubSubQueueMessage = {
  emailAddress: string;
  historyId: string;
  pubSubMessageId: string;
  type: "notification";
};

type RequestErrorStatus = 400 | 401 | 403 | 413 | 503;

class RequestError extends Error {
  constructor(
    readonly status: RequestErrorStatus,
    readonly category: string,
  ) {
    super(category);
  }
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const INTERNAL_EVENT_BODY_LIMIT = 1_024;
const PUBSUB_BODY_LIMIT = 64 * 1_024;
const textEncoder = new TextEncoder();

const pubSubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().min(1),
  }),
  subscription: z.string().min(1),
});

const gmailNotificationSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z
    .union([
      z.string().regex(/^\d+$/),
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String),
    ])
    .pipe(z.string().min(1)),
});

const tokenPayloadSchema = z.object({
  emailAddress: z.string().email(),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  mailboxId: z.string().min(1),
  nonce: z.string().uuid(),
  userId: z.string().min(1),
  version: z.literal(1),
});

const decodeBase64Url = (value: string) => {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
};

const encodeBase64Url = (value: ArrayBuffer) => {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const signTokenPayload = async (encodedPayload: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return encodeBase64Url(await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload)));
};

export const signaturesMatch = async (actual: string, expected: string) => {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(actual)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(actualDigest, expectedDigest);
};

const verifyLiveSyncToken = async (token: string, secret: string) => {
  const [encodedPayload, encodedSignature, extraPart] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraPart) {
    throw new RequestError(401, "live_sync_token_malformed");
  }

  const expectedSignature = await signTokenPayload(encodedPayload, secret);
  if (!(await signaturesMatch(encodedSignature, expectedSignature))) {
    throw new RequestError(401, "live_sync_token_signature_invalid");
  }

  const payload = tokenPayloadSchema.safeParse(
    (() => {
      try {
        return JSON.parse(decodeBase64Url(encodedPayload));
      } catch {
        return undefined;
      }
    })(),
  );
  if (!payload.success) throw new RequestError(401, "live_sync_token_payload_invalid");

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.data.expiresAt <= nowSeconds || payload.data.issuedAt > nowSeconds + 30) {
    throw new RequestError(401, "live_sync_token_inactive");
  }
  return payload.data;
};

const readLinkedSecret = (value: string) =>
  z.object({ value: z.string().min(1) }).parse(JSON.parse(value)).value;

const readBoundedJson = async (request: Request, limit: number) => {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new RequestError(413, "request_body_too_large");
  }
  if (!request.body) throw new RequestError(400, "request_body_missing");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RequestError(413, "request_body_too_large");
      }
      chunks.push(value);
    }
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

const verifyPubSubToken = async (request: Request, env: Env) => {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new RequestError(401, "pubsub_bearer_missing");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, GOOGLE_JWKS, {
      audience: env.GMAIL_PUBSUB_PUSH_AUDIENCE,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
    }));
  } catch (error) {
    if (error instanceof joseErrors.JWKSTimeout) {
      throw new RequestError(503, "pubsub_jwks_unavailable");
    }
    if (error instanceof joseErrors.JOSEError) {
      throw new RequestError(401, "pubsub_bearer_invalid");
    }
    throw error;
  }
  if (
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT.toLowerCase()
  ) {
    throw new RequestError(403, "pubsub_service_account_invalid");
  }
};

const parseNotification = (data: string) => {
  try {
    return gmailNotificationSchema.parse(JSON.parse(decodeBase64Url(data)));
  } catch {
    throw new RequestError(400, "pubsub_notification_invalid");
  }
};

const mailboxObject = (env: Env, emailAddress: string) => {
  const id = env.GmailLiveSyncMailbox.idFromName(emailAddress.trim().toLowerCase());
  return env.GmailLiveSyncMailbox.get(id);
};

const handleLiveSync = async (request: Request, env: Env) => {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) throw new RequestError(401, "live_sync_token_missing");

  const payload = await verifyLiveSyncToken(
    token,
    readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret),
  );
  return mailboxObject(env, payload.emailAddress).fetch(request);
};

const handlePubSub = async (request: Request, env: Env) => {
  await verifyPubSubToken(request, env);
  const envelope = pubSubEnvelopeSchema.safeParse(
    await readBoundedJson(request, PUBSUB_BODY_LIMIT),
  );
  if (!envelope.success) throw new RequestError(400, "pubsub_envelope_invalid");
  if (envelope.data.subscription !== env.GMAIL_PUBSUB_SUBSCRIPTION) {
    throw new RequestError(403, "pubsub_subscription_invalid");
  }

  const notification = parseNotification(envelope.data.message.data);
  const emailAddress = notification.emailAddress.trim().toLowerCase();
  const broadcastResponse = await mailboxObject(env, emailAddress).fetch(
    "https://internal.quieter/broadcast",
    {
      body: JSON.stringify({ type: "mailbox-dirty" }),
      method: "POST",
    },
  );
  if (!broadcastResponse.ok) throw new Error("Durable Object broadcast failed.");

  const queueMessage: GmailPubSubQueueMessage = {
    emailAddress,
    historyId: notification.historyId,
    pubSubMessageId: envelope.data.message.messageId,
    type: "notification",
  };
  await env.GmailPsQueue.send(queueMessage);
  return new Response(null, { status: 204 });
};

const requestErrorResponse = (error: unknown, route: string) => {
  const status = error instanceof RequestError ? error.status : 500;
  const category = error instanceof RequestError ? error.category : "internal_error";
  console.error(JSON.stringify({ category, route, status }));
  return Response.json({ error: "Request failed" }, { status });
};

export class GmailLiveSyncMailbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"action":"ping"}', '{"type":"pong"}'),
    );
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    console.error(
      JSON.stringify({
        category: "websocket_unexpected_message",
        route: "durable_object",
        size: typeof message === "string" ? message.length : message.byteLength,
      }),
    );
    ws.close(1003, "Unexpected message");
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const token = new URL(request.url).searchParams.get("token");
        if (!token) throw new RequestError(401, "live_sync_token_missing");
        const payload = await verifyLiveSyncToken(
          token,
          readLinkedSecret(this.env.SST_RESOURCE_GmailLiveSyncTokenSecret),
        );
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.serializeAttachment({ mailboxId: payload.mailboxId });
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }

      if (request.method === "POST") {
        const event = z
          .object({ type: z.enum(["mailbox-details-dirty", "mailbox-dirty"]) })
          .safeParse(await readBoundedJson(request, INTERNAL_EVENT_BODY_LIMIT));
        if (!event.success) throw new RequestError(400, "broadcast_event_invalid");

        for (const socket of this.ctx.getWebSockets()) {
          const attachment = z
            .object({ mailboxId: z.string().min(1) })
            .safeParse(socket.deserializeAttachment());
          if (attachment.success) {
            socket.send(
              JSON.stringify({ mailboxId: attachment.data.mailboxId, type: event.data.type }),
            );
          }
        }
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 404 });
    } catch (error) {
      if (error instanceof RequestError) return requestErrorResponse(error, "durable_object");
      throw error;
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const route = new URL(request.url).pathname;
    try {
      if (route === "/gmail/live") return await handleLiveSync(request, env);
      if (route === "/gmail/pubsub" && request.method === "POST") {
        return await handlePubSub(request, env);
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return requestErrorResponse(error, route);
    }
  },

  async queue(batch, env, _ctx) {
    await Promise.all(
      batch.messages.map(async (message) => {
        const response = await fetch(env.GMAIL_PUBSUB_PROCESS_URL, {
          body: JSON.stringify(message.body),
          headers: {
            authorization: `Bearer ${readLinkedSecret(env.SST_RESOURCE_GmailPubSubProcessToken)}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        if (!response.ok) {
          console.error(
            JSON.stringify({
              category: "processor_response_error",
              route: "queue",
              status: response.status,
            }),
          );
          throw new Error(`Gmail Pub/Sub processor returned ${response.status}.`);
        }
        message.ack();
      }),
    );
  },
} satisfies ExportedHandler<Env, GmailPubSubQueueMessage>;
