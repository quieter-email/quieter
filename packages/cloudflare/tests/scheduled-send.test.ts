import { configureServerEnv } from "@quieter/env/server";
import { readScheduledSendTicket } from "@quieter/mail/scheduled-send-ticket";
import { signMailPayload } from "@quieter/mail/updates";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { handleMailUpdates } from "../src/mail-updates";

describe("durable scheduled sending", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserves its timer through eviction and follows the authoritative send time", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "scheduled-mailbox",
      userId: "scheduled-owner",
    };
    const futureSendAt = Date.now() + 86_400_000;
    let nextWakeAt: number | null = futureSendAt;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(
          input instanceof URL ? input.toString() : input,
          init
        );
        expect(request.url).toBe(
          "https://quieter.example/api/internal/scheduled-send"
        );
        const authenticated = await readScheduledSendTicket(
          request,
          "live-sync-secret",
          "scheduled-send-dispatch"
        );
        expect(authenticated).toMatchObject({ ok: true, ticket: scope });
        return Response.json({ nextWakeAt });
      })
    );
    const body = JSON.stringify({
      ...scope,
      expiresAt: Date.now() + 20_000,
      purpose: "scheduled-send-wake",
    });
    const stub = env.ScheduledSend.get(
      env.ScheduledSend.idFromName(
        JSON.stringify([scope.userId, scope.mailboxId, scope.id])
      )
    );
    const response = await handleMailUpdates(
      new Request("https://updates.example/mail/scheduled-send/wake", {
        body,
        headers: {
          "x-mail-signature": await signMailPayload(body, "live-sync-secret"),
        },
        method: "POST",
      }),
      env
    );
    expect(response.status).toBe(204);
    await evictDurableObject(stub);
    await runInDurableObject(stub, () => {
      configureServerEnv({ BETTER_AUTH_URL: "https://quieter.example" });
    });
    await runDurableObjectAlarm(stub);
    await expect(
      runInDurableObject(
        stub,
        async (_instance, state) => await state.storage.getAlarm()
      )
    ).resolves.toBe(futureSendAt);
    nextWakeAt = null;
    await runDurableObjectAlarm(stub);
    await expect(
      runInDurableObject(
        stub,
        async (_instance, state) => await state.storage.getAlarm()
      )
    ).resolves.toBeNull();
  });

  test("rejects wake tickets minted for dispatch", async () => {
    const body = JSON.stringify({
      expiresAt: Date.now() + 20_000,
      id: crypto.randomUUID(),
      mailboxId: "scheduled-mailbox",
      purpose: "scheduled-send-dispatch",
      userId: "scheduled-owner",
    });
    const response = await handleMailUpdates(
      new Request("https://updates.example/mail/scheduled-send/wake", {
        body,
        headers: {
          "x-mail-signature": await signMailPayload(body, "live-sync-secret"),
        },
        method: "POST",
      }),
      env
    );
    expect(response.status).toBe(401);
  });

  test("accepts a new wake during dispatch and preserves it after the old callback completes", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "scheduled-mailbox",
      userId: "scheduled-owner",
    };
    const stub = env.ScheduledSend.get(
      env.ScheduledSend.idFromName(
        JSON.stringify([scope.userId, scope.mailboxId, scope.id])
      )
    );
    await stub.fetch("https://internal/scheduled-send/wake", {
      body: JSON.stringify(scope),
      method: "POST",
    });
    await runInDurableObject(stub, () => {
      configureServerEnv({ BETTER_AUTH_URL: "https://quieter.example" });
    });
    const started = Promise.withResolvers<null>();
    const finish = Promise.withResolvers<null>();
    const futureSendAt = Date.now() + 86_400_000;
    let dispatched = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        if (dispatched) {
          return Response.json({ nextWakeAt: futureSendAt });
        }
        dispatched = true;
        started.resolve(null);
        await finish.promise;
        return Response.json({ nextWakeAt: null });
      })
    );
    const originalAlarm = runDurableObjectAlarm(stub);
    await started.promise;
    let wakeAccepted = false;
    const wake = env.ScheduledSend.get(stub.id)
      .fetch("https://internal/scheduled-send/wake", {
        body: JSON.stringify(scope),
        method: "POST",
      })
      .then((response) => {
        wakeAccepted = response.status === 204;
      });
    try {
      await vi.waitFor(() => {
        expect(wakeAccepted).toBeTruthy();
      });
    } finally {
      finish.resolve(null);
      await originalAlarm;
      await wake;
    }
    await runDurableObjectAlarm(env.ScheduledSend.get(stub.id));
    await expect(
      runInDurableObject(
        env.ScheduledSend.get(stub.id),
        async (_instance, state) => await state.storage.getAlarm()
      )
    ).resolves.toBe(futureSendAt);
  });
});
