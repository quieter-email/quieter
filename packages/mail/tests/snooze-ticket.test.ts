import { describe, expect, test } from "vite-plus/test";

import { readMailSnoozeTicket } from "../src/snooze-ticket";
import { signMailPayload } from "../src/updates";

const secret = "mail-snooze-ticket-test-secret";
const scope = { id: crypto.randomUUID(), mailboxId: "mailbox" };

describe("mail snooze dispatch authentication", () => {
  test("authenticates exact bytes and rejects changed schedule or mailbox scopes", async () => {
    const ticket = {
      ...scope,
      expiresAt: Date.now() + 20_000,
      purpose: "mail-snooze-dispatch",
    };
    const body = JSON.stringify(ticket, null, 2);
    const signature = await signMailPayload(body, secret);
    const accepted = await readMailSnoozeTicket(
      new Request("https://quieter.example/api/internal/mail-snooze", {
        body,
        headers: { "x-mail-signature": signature },
        method: "POST",
      }),
      secret,
      "mail-snooze-dispatch"
    );
    expect(accepted).toMatchObject({ ok: true, ticket: scope });
    for (const altered of [
      JSON.stringify({ ...ticket, id: crypto.randomUUID() }),
      JSON.stringify({ ...ticket, mailboxId: "another-mailbox" }),
      JSON.stringify(ticket),
    ]) {
      const rejected = await readMailSnoozeTicket(
        new Request("https://quieter.example/api/internal/mail-snooze", {
          body: altered,
          headers: { "x-mail-signature": signature },
          method: "POST",
        }),
        secret,
        "mail-snooze-dispatch"
      );
      expect(rejected).toMatchObject({ ok: false, status: 401 });
    }
  });

  test("rejects signed expiry, purpose and actor substitutions", async () => {
    const ticket = {
      ...scope,
      expiresAt: Date.now() + 20_000,
      purpose: "mail-snooze-dispatch",
    };
    for (const invalid of [
      { ...ticket, expiresAt: Date.now() - 1 },
      { ...ticket, expiresAt: Date.now() + 120_000 },
      { ...ticket, purpose: "mail-snooze-wake" },
      { ...ticket, purpose: "scheduled-send-dispatch" },
      { ...ticket, userId: "different-actor" },
    ]) {
      const body = JSON.stringify(invalid);
      const rejected = await readMailSnoozeTicket(
        new Request("https://quieter.example/api/internal/mail-snooze", {
          body,
          headers: { "x-mail-signature": await signMailPayload(body, secret) },
          method: "POST",
        }),
        secret,
        "mail-snooze-dispatch"
      );
      expect(rejected).toMatchObject({ ok: false, status: 401 });
    }
  });

  test("rejects malformed signed JSON and invalid UTF-8", async () => {
    const body = "{not-json}";
    const malformed = await readMailSnoozeTicket(
      new Request("https://quieter.example/api/internal/mail-snooze", {
        body,
        headers: { "x-mail-signature": await signMailPayload(body, secret) },
        method: "POST",
      }),
      secret,
      "mail-snooze-dispatch"
    );
    expect(malformed).toMatchObject({ ok: false, status: 400 });
    const invalidBytes = await readMailSnoozeTicket(
      new Request("https://quieter.example/api/internal/mail-snooze", {
        body: new Uint8Array([0xc3, 0x28]),
        method: "POST",
      }),
      secret,
      "mail-snooze-dispatch"
    );
    expect(invalidBytes).toMatchObject({ ok: false, status: 400 });
  });

  test("bounds streamed bodies without relying on content-length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
        controller.close();
      },
    });
    const init = { body, duplex: "half", method: "POST" };
    const rejected = await readMailSnoozeTicket(
      new Request("https://quieter.example/api/internal/mail-snooze", init),
      secret,
      "mail-snooze-dispatch"
    );
    expect(rejected).toMatchObject({ ok: false, status: 413 });
  });
});
