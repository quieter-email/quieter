import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

type GmailPubSubQueueMessage = {
  emailAddress: string;
  historyId: string;
  pubSubMessageId: string;
  type: "notification";
};

type Env = {
  GmailLiveSyncMailbox: DurableObjectNamespace;
  GmailPubSubCloudflareQueue: Queue<GmailPubSubQueueMessage>;
  GMAIL_PUBSUB_PROCESS_URL: string;
  GMAIL_PUBSUB_PUSH_AUDIENCE: string;
  GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: string;
  GMAIL_PUBSUB_SUBSCRIPTION: string;
  SST_RESOURCE_GmailLiveSyncTokenSecret: string;
  SST_RESOURCE_GmailPubSubProcessToken: string;
};

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

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
  emailAddress: z.string().email().optional(),
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
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return encodeBase64Url(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload)),
  );
};

const verifyLiveSyncToken = async (token: string, secret: string) => {
  const [encodedPayload, encodedSignature, extraPart] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraPart) {
    throw new Error("Live-sync token is malformed.");
  }

  const expectedSignature = await signTokenPayload(encodedPayload, secret);
  if (expectedSignature !== encodedSignature) {
    throw new Error("Live-sync token signature is invalid.");
  }

  const payload = tokenPayloadSchema.parse(JSON.parse(decodeBase64Url(encodedPayload)));
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.expiresAt <= nowSeconds || payload.issuedAt > nowSeconds + 30) {
    throw new Error("Live-sync token is expired or not active.");
  }
  return payload;
};

const readLinkedSecret = (value: string) =>
  z.object({ value: z.string().min(1) }).parse(JSON.parse(value)).value;

const verifyPubSubToken = async (request: Request, env: Env) => {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Missing Pub/Sub bearer token.");

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    audience: env.GMAIL_PUBSUB_PUSH_AUDIENCE,
    issuer: ["accounts.google.com", "https://accounts.google.com"],
  });
  if (
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT.toLowerCase()
  ) {
    throw new Error("Pub/Sub push token service account is invalid.");
  }
};

const parseNotification = (data: string) =>
  gmailNotificationSchema.parse(JSON.parse(decodeBase64Url(data)));

const mailboxObject = (env: Env, emailAddress: string) => {
  const id = env.GmailLiveSyncMailbox.idFromName(emailAddress.trim().toLowerCase());
  return env.GmailLiveSyncMailbox.get(id);
};

const handleLiveSync = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response(null, { status: 401 });

  const payload = await verifyLiveSyncToken(
    token,
    readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret),
  );
  const objectKey = payload.emailAddress ?? payload.mailboxId;
  return mailboxObject(env, objectKey).fetch(request);
};

const handlePubSub = async (request: Request, env: Env) => {
  await verifyPubSubToken(request, env);
  const envelope = pubSubEnvelopeSchema.parse(await request.json());
  if (envelope.subscription !== env.GMAIL_PUBSUB_SUBSCRIPTION) {
    return Response.json({ error: "Unexpected subscription" }, { status: 403 });
  }

  const notification = parseNotification(envelope.message.data);
  const emailAddress = notification.emailAddress.trim().toLowerCase();
  await mailboxObject(env, emailAddress).fetch("https://internal.quieter/broadcast", {
    body: JSON.stringify({ type: "mailbox-dirty" }),
    method: "POST",
  });
  await env.GmailPubSubCloudflareQueue.send({
    emailAddress,
    historyId: notification.historyId,
    pubSubMessageId: envelope.message.messageId,
    type: "notification",
  });

  return new Response(null, { status: 204 });
};

export class GmailLiveSyncMailbox {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const upgrade = request.headers.get("upgrade");
    if (upgrade?.toLowerCase() === "websocket") {
      const token = new URL(request.url).searchParams.get("token");
      if (!token) return new Response(null, { status: 401 });
      const payload = await verifyLiveSyncToken(
        token,
        readLinkedSecret(this.env.SST_RESOURCE_GmailLiveSyncTokenSecret),
      );
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.serializeAttachment({ mailboxId: payload.mailboxId });
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST") {
      const event = z
        .object({
          type: z.enum(["mailbox-details-dirty", "mailbox-dirty"]),
        })
        .parse(await request.json());
      for (const socket of this.state.getWebSockets()) {
        const attachment = z
          .object({ mailboxId: z.string().min(1) })
          .safeParse(socket.deserializeAttachment());
        if (attachment.success) {
          socket.send(JSON.stringify({ mailboxId: attachment.data.mailboxId, type: event.type }));
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 404 });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message.includes("ping")) {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/gmail/live") return await handleLiveSync(request, env);
      if (url.pathname === "/gmail/pubsub" && request.method === "POST") {
        return await handlePubSub(request, env);
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unknown Cloudflare worker error.");
      return Response.json({ error: "Request failed" }, { status: 400 });
    }
  },

  async queue(batch, env) {
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
          throw new Error(`Gmail Pub/Sub processor returned ${response.status}.`);
        }
        message.ack();
      }),
    );
  },
} satisfies ExportedHandler<Env, GmailPubSubQueueMessage>;
