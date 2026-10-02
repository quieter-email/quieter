import {
  mailConnectionSchema,
  mailUpdateSchema,
  verifyMailPayload,
} from "@quieter/mail/updates";
import { DurableObject } from "cloudflare:workers";

import { readLinkedSecret } from "./worker-runtime";

const SESSION_MS = 5 * 60_000;

export class MailLiveUser extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"action":"ping"}', '{"type":"pong"}')
    );
  }

  async alarm() {
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment: unknown = socket.deserializeAttachment();
      const expiresAt =
        typeof attachment === "object" &&
        attachment !== null &&
        "expiresAt" in attachment
          ? attachment.expiresAt
          : 0;
      if (typeof expiresAt !== "number" || expiresAt <= Date.now()) {
        socket.close(4001, "Renew connection");
      } else {
        nextExpiry = Math.min(nextExpiry, expiresAt);
      }
    }
    if (Number.isFinite(nextExpiry)) {
      await this.ctx.storage.setAlarm(nextExpiry);
    }
  }

  // oxlint-disable-next-line class-methods-use-this -- Runtime dispatches this Durable Object callback.
  webSocketMessage(socket: WebSocket) {
    socket.close(1003, "Unexpected message");
  }

  async fetch(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const url = new URL(request.url);
      const ticket = url.searchParams.get("ticket") ?? "";
      if (
        !(await verifyMailPayload(
          ticket,
          url.searchParams.get("signature") ?? "",
          readLinkedSecret(this.env.SST_RESOURCE_GmailLiveSyncTokenSecret)
        ))
      ) {
        return new Response(null, { status: 401 });
      }
      const parsed = mailConnectionSchema.safeParse(JSON.parse(ticket));
      if (
        !parsed.success ||
        parsed.data.expiresAt <= Date.now() ||
        parsed.data.expiresAt > Date.now() + 90_000
      ) {
        return new Response(null, { status: 401 });
      }
      const pair = new WebSocketPair();
      const expiresAt = Date.now() + SESSION_MS;
      pair[1].serializeAttachment({ expiresAt });
      this.ctx.acceptWebSocket(pair[1]);
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > expiresAt) {
        await this.ctx.storage.setAlarm(expiresAt);
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 404 });
    }
    const event = mailUpdateSchema.parse(await request.json());
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
    return new Response(null, { status: 204 });
  }
}
