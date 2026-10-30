import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

import worker from "../src/worker";

describe("retired Gmail live-sync transport", () => {
  test.each(["mailbox-dirty", "mailbox-details-dirty"])(
    "never delivers %s to a retained legacy socket after hibernation",
    async (type) => {
      const stub = env.GmailLiveSyncMailboxV2.get(
        env.GmailLiveSyncMailboxV2.idFromName(crypto.randomUUID())
      );
      await runInDurableObject(stub, (instance, state) => {
        const currentFetch = instance.fetch.bind(instance);
        instance.fetch = () => {
          const pair = new WebSocketPair();
          pair[1].serializeAttachment({ mailboxId: "previous-owner-mailbox" });
          state.acceptWebSocket(pair[1]);
          instance.fetch = currentFetch;
          return new Response(null, { status: 101, webSocket: pair[0] });
        };
      });
      const connection = await stub.fetch("https://internal/legacy", {
        headers: { upgrade: "websocket" },
      });
      const socket = connection.webSocket;
      if (socket === null) {
        throw new Error("Expected retained socket.");
      }
      socket.accept();
      const messages: unknown[] = [];
      socket.addEventListener("message", (event) => {
        messages.push(event.data);
      });
      const closed = Promise.withResolvers<CloseEvent>();
      socket.addEventListener("close", closed.resolve, { once: true });
      await evictDurableObject(stub);
      const response = await stub.fetch("https://internal/broadcast", {
        body: JSON.stringify({ type }),
        method: "POST",
      });
      expect(response.status).toBe(410);
      await closed.promise;
      expect(messages).toHaveLength(0);
    }
  );

  test("rejects upgrades at both the Worker and direct Durable Object boundary", async () => {
    const stub = env.GmailLiveSyncMailboxV2.get(
      env.GmailLiveSyncMailboxV2.idFromName(crypto.randomUUID())
    );
    const request = new Request("https://worker.invalid/gmail/live?token=old", {
      headers: { upgrade: "websocket" },
    });
    const workerResponse = await worker.fetch(request.clone(), env);
    const objectResponse = await stub.fetch(request);
    expect(workerResponse.status).toBe(404);
    expect(objectResponse.status).toBe(410);
  });
});
