import { DurableObject } from "cloudflare:workers";

// Keep the deployed class so hibernated legacy sockets fail closed after upgrade.
export class GmailLiveSyncMailboxV2 extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse();
    for (const socket of ctx.getWebSockets()) {
      socket.close(1008, "Connection retired");
    }
  }

  // oxlint-disable-next-line class-methods-use-this -- Runtime dispatches this Durable Object callback.
  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Connection retired");
  }

  fetch() {
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1008, "Connection retired");
    }
    return new Response(null, { status: 410 });
  }
}
