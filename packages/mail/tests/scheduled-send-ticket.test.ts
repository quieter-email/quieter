import { describe, expect, test } from "vite-plus/test";

import { readScheduledSendTicket } from "../src/scheduled-send-ticket";
import { signMailPayload } from "../src/updates";

const secret = "scheduled-send-test-secret";

const ticket = {
  expiresAt: Date.now() + 20_000,
  id: crypto.randomUUID(),
  mailboxId: "mailbox-owner",
  purpose: "scheduled-send-dispatch",
  userId: "owner",
};

describe("scheduled send dispatch authentication", () => {
  test("authenticates exact request bytes and rejects altered scopes", async () => {
    const body = JSON.stringify(ticket, null, 2);
    const signature = await signMailPayload(body, secret);
    const accepted = await readScheduledSendTicket(
      new Request("https://quieter.example/api/internal/scheduled-send", {
        body,
        headers: { "x-mail-signature": signature },
        method: "POST",
      }),
      secret,
      "scheduled-send-dispatch"
    );
    expect(accepted).toMatchObject({
      ok: true,
      ticket: {
        id: ticket.id,
        mailboxId: ticket.mailboxId,
        userId: ticket.userId,
      },
    });
    for (const altered of [
      JSON.stringify({ ...ticket, mailboxId: "another-mailbox" }),
      JSON.stringify({ ...ticket, userId: "another-user" }),
      JSON.stringify({ ...ticket, id: crypto.randomUUID() }),
      JSON.stringify(ticket),
    ]) {
      const rejected = await readScheduledSendTicket(
        new Request("https://quieter.example/api/internal/scheduled-send", {
          body: altered,
          headers: { "x-mail-signature": signature },
          method: "POST",
        }),
        secret,
        "scheduled-send-dispatch"
      );
      expect(rejected).toMatchObject({ ok: false, status: 401 });
    }
  });

  test("rejects expired, extended and wrong-purpose signed tickets", async () => {
    for (const invalid of [
      { ...ticket, expiresAt: Date.now() - 1 },
      { ...ticket, expiresAt: Date.now() + 120_000 },
      { ...ticket, purpose: "scheduled-send-wake" },
      { ...ticket, purpose: "mail-connection" },
    ]) {
      const body = JSON.stringify(invalid);
      const rejected = await readScheduledSendTicket(
        new Request("https://quieter.example/api/internal/scheduled-send", {
          body,
          headers: { "x-mail-signature": await signMailPayload(body, secret) },
          method: "POST",
        }),
        secret,
        "scheduled-send-dispatch"
      );
      expect(rejected).toMatchObject({ ok: false, status: 401 });
    }
  });

  test("bounds streamed input even without a content length", async () => {
    const oversized = new TextEncoder().encode("x".repeat(8192));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    const init = { body, duplex: "half", method: "POST" };
    const rejected = await readScheduledSendTicket(
      new Request("https://quieter.example/api/internal/scheduled-send", init),
      secret,
      "scheduled-send-dispatch"
    );
    expect(rejected).toMatchObject({ ok: false, status: 413 });
  });
});
