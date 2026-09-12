import { signMailPayload } from "@quieter/mail/updates";
import {
  evictDurableObject,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

import { handleMailUpdates } from "../src/mail-updates";

describe("per-user mail connections", () => {
  test("keeps multiple tabs connected through hibernation", async () => {
    const userId = crypto.randomUUID();
    const ticket = JSON.stringify({
      expiresAt: Date.now() + 60_000,
      purpose: "mail-connection",
      userId,
    });
    const url = new URL("https://example.invalid/mail/live");
    url.searchParams.set("ticket", ticket);
    url.searchParams.set(
      "signature",
      await signMailPayload(ticket, "live-sync-secret")
    );
    const responses = await Promise.all(
      [0, 1].map(
        async () =>
          await handleMailUpdates(
            new Request(url, { headers: { upgrade: "websocket" } }),
            env
          )
      )
    );
    const sockets = responses.map((response) => {
      expect(response.status).toBe(101);
      if (!response.webSocket) {
        throw new Error("Socket missing");
      }
      response.webSocket.accept();
      return response.webSocket;
    });
    const stub = env.MailLiveUser.get(env.MailLiveUser.idFromName(userId));
    await evictDurableObject(stub);
    const event = {
      eventId: crypto.randomUUID(),
      mailboxId: "managed-mailbox",
      type: "mailbox.changed",
    };
    const messages = sockets.map(async (socket) => {
      const deferred = Promise.withResolvers<string>();
      socket.addEventListener(
        "message",
        (message) => {
          deferred.resolve(String(message.data));
        },
        { once: true }
      );
      return await deferred.promise;
    });
    await stub.fetch("https://internal/events", {
      body: JSON.stringify(event),
      method: "POST",
    });
    await expect(Promise.all(messages)).resolves.toStrictEqual([
      JSON.stringify(event),
      JSON.stringify(event),
    ]);
    for (const socket of sockets) {
      socket.close();
    }
  });

  test("routes tickets to separate users and expires established sessions", async () => {
    const users = [crypto.randomUUID(), crypto.randomUUID()];
    const responses = await Promise.all(
      users.map(async (userId) => {
        const ticket = JSON.stringify({
          expiresAt: Date.now() + 60_000,
          purpose: "mail-connection",
          userId,
        });
        const url = new URL("https://example.invalid/mail/live");
        url.searchParams.set("ticket", ticket);
        url.searchParams.set(
          "signature",
          await signMailPayload(ticket, "live-sync-secret")
        );
        return await handleMailUpdates(
          new Request(url, { headers: { upgrade: "websocket" } }),
          env
        );
      })
    );
    const sockets = responses.map((response) => {
      if (!response.webSocket) {
        throw new Error("Socket missing");
      }
      response.webSocket.accept();
      return response.webSocket;
    });
    const received: string[] = [];
    sockets[1].addEventListener("message", (message) => {
      received.push(String(message.data));
    });
    const firstMessage = Promise.withResolvers<string>();
    sockets[0].addEventListener(
      "message",
      (message) => {
        firstMessage.resolve(String(message.data));
      },
      { once: true }
    );
    const first = env.MailLiveUser.get(env.MailLiveUser.idFromName(users[0]));
    const event = {
      eventId: crypto.randomUUID(),
      mailboxId: "private",
      type: "mailbox.changed",
    };
    await first.fetch("https://internal/events", {
      body: JSON.stringify(event),
      method: "POST",
    });
    await expect(firstMessage.promise).resolves.toBe(JSON.stringify(event));
    const otherMessage = Promise.withResolvers<string>();
    sockets[1].addEventListener(
      "message",
      (message) => {
        otherMessage.resolve(String(message.data));
      },
      { once: true }
    );
    const otherEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      mailboxId: "other-private",
    };
    await env.MailLiveUser.get(env.MailLiveUser.idFromName(users[1])).fetch(
      "https://internal/events",
      { body: JSON.stringify(otherEvent), method: "POST" }
    );
    await expect(otherMessage.promise).resolves.toBe(
      JSON.stringify(otherEvent)
    );
    expect(received).toStrictEqual([JSON.stringify(otherEvent)]);
    const closed = Promise.withResolvers<number>();
    sockets[0].addEventListener("close", (closeEvent) => {
      closed.resolve(closeEvent.code);
    });
    await runInDurableObject(first, (_instance, state) => {
      for (const socket of state.getWebSockets()) {
        socket.serializeAttachment({ expiresAt: Date.now() - 1 });
      }
    });
    await runDurableObjectAlarm(first);
    await expect(closed.promise).resolves.toBe(4001);
    sockets[0].close();
    sockets[1].close();
  });

  test("rejects invalid and expired connection tickets", async () => {
    const url = new URL("https://example.invalid/mail/live");
    const ticket = JSON.stringify({
      expiresAt: Date.now() - 1,
      purpose: "mail-connection",
      userId: "user",
    });
    url.searchParams.set("ticket", ticket);
    url.searchParams.set(
      "signature",
      await signMailPayload(ticket, "live-sync-secret")
    );
    const response = await handleMailUpdates(new Request(url), env);
    expect(response.status).toBe(401);
    url.searchParams.set("signature", "invalid");
    const invalid = await handleMailUpdates(new Request(url), env);
    expect(invalid.status).toBe(401);
  });
});
