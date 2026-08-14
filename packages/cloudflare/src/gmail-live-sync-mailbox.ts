import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { RequestError } from "./request-error";
import {
  readBoundedJson,
  readLinkedSecret,
  reportWorkerError,
  verifyLiveSyncToken,
} from "./worker-utils";

const INTERNAL_EVENT_BODY_LIMIT = 1024;

const requestErrorResponse = (error: unknown, route: string) => {
  const status = error instanceof RequestError ? error.status : 500;
  const category =
    error instanceof RequestError ? error.category : "internal_error";
  if (status >= 500) {
    reportWorkerError(error, { category, route, status });
  }
  return Response.json({ error: "Request failed" }, { status });
};

export class GmailLiveSyncMailbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"action":"ping"}', '{"type":"pong"}')
    );
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    reportWorkerError(
      new Error("Unexpected Gmail live-sync WebSocket message."),
      {
        activeSockets: this.ctx.getWebSockets().length,
        category: "websocket_unexpected_message",
        route: "durable_object",
        size: typeof message === "string" ? message.length : message.byteLength,
      }
    );
    ws.close(1003, "Unexpected message");
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const token = new URL(request.url).searchParams.get("token");
        if (token === null || token === "") {
          throw new RequestError(401, "live_sync_token_missing");
        }
        const payload = await verifyLiveSyncToken(
          token,
          readLinkedSecret(this.env.SST_RESOURCE_GmailLiveSyncTokenSecret)
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
        if (!event.success) {
          throw new RequestError(400, "broadcast_event_invalid");
        }

        for (const socket of this.ctx.getWebSockets()) {
          const attachment = z
            .object({ mailboxId: z.string().min(1) })
            .safeParse(socket.deserializeAttachment());
          if (attachment.success) {
            socket.send(
              JSON.stringify({
                mailboxId: attachment.data.mailboxId,
                type: event.data.type,
              })
            );
          }
        }
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 404 });
    } catch (error) {
      if (error instanceof RequestError) {
        return requestErrorResponse(error, "durable_object");
      }
      throw error;
    }
  }
}
