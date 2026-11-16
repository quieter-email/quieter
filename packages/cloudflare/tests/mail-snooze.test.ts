import { configureServerEnv } from "@quieter/env/server";
import { readMailSnoozeTicket } from "@quieter/mail/snooze-ticket";
import { signMailPayload } from "@quieter/mail/updates";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { MailSnooze } from "../src/mail-snooze";
import { handleMailUpdates } from "../src/mail-updates";

declare global {
  // oxlint-disable-next-line typescript/no-namespace -- Workerd exposes native bindings through Cloudflare.Env.
  namespace Cloudflare {
    // oxlint-disable-next-line typescript/consistent-type-definitions -- Cloudflare.Env requires interface merging.
    interface Env {
      MailSnooze: DurableObjectNamespace<MailSnooze>;
    }
  }
}

describe("durable mail Snooze", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("wakes an actor-free scope after eviction and clears a terminal schedule", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "snooze-mailbox",
    };
    const returnAt = Date.now() + 86_400_000;
    let nextWakeAt: number | null = returnAt;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(
          input instanceof URL ? input.toString() : input,
          init
        );
        expect(request.url).toBe(
          "https://quieter.example/api/internal/mail-snooze"
        );
        const authenticated = await readMailSnoozeTicket(
          request,
          "live-sync-secret",
          "mail-snooze-dispatch"
        );
        expect(authenticated).toMatchObject({ ok: true, ticket: scope });
        return Response.json({ nextWakeAt });
      })
    );
    const body = JSON.stringify({
      ...scope,
      expiresAt: Date.now() + 20_000,
      purpose: "mail-snooze-wake",
    });
    const stub = env.MailSnooze.get(
      env.MailSnooze.idFromName(JSON.stringify([scope.mailboxId, scope.id]))
    );
    const response = await handleMailUpdates(
      new Request("https://updates.example/mail/snooze/wake", {
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
    ).resolves.toBe(returnAt);
    nextWakeAt = null;
    await runDurableObjectAlarm(stub);
    await expect(
      runInDurableObject(
        stub,
        async (_instance, state) => await state.storage.getAlarm()
      )
    ).resolves.toBeNull();
    await expect(
      runInDurableObject(
        stub,
        async (_instance, state) => await state.storage.get("scope")
      )
    ).resolves.toBeUndefined();
  });

  test("rejects dispatch tickets and signed wake bodies whose scope was changed", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "snooze-original-mailbox",
    };
    const ticket = {
      ...scope,
      expiresAt: Date.now() + 20_000,
      purpose: "mail-snooze-wake",
    };
    const body = JSON.stringify(ticket);
    const signature = await signMailPayload(body, "live-sync-secret");
    const dispatchBody = JSON.stringify({
      ...ticket,
      purpose: "mail-snooze-dispatch",
    });
    const alteredScope = { ...scope, mailboxId: "snooze-other-mailbox" };
    for (const invalid of [
      {
        body: dispatchBody,
        signature: await signMailPayload(dispatchBody, "live-sync-secret"),
      },
      {
        body: JSON.stringify({ ...ticket, mailboxId: alteredScope.mailboxId }),
        signature,
      },
      {
        body: JSON.stringify({ ...ticket, id: crypto.randomUUID() }),
        signature,
      },
    ]) {
      const response = await handleMailUpdates(
        new Request("https://updates.example/mail/snooze/wake", {
          body: invalid.body,
          headers: { "x-mail-signature": invalid.signature },
          method: "POST",
        }),
        env
      );
      expect(response.status).toBe(401);
    }
    for (const rejectedScope of [scope, alteredScope]) {
      const stub = env.MailSnooze.get(
        env.MailSnooze.idFromName(
          JSON.stringify([rejectedScope.mailboxId, rejectedScope.id])
        )
      );
      await expect(
        runInDurableObject(
          stub,
          async (_instance, state) => await state.storage.getAlarm()
        )
      ).resolves.toBeNull();
    }
  });

  test("preserves a new wake while an older terminal callback is in flight", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "snooze-mailbox",
    };
    const stub = env.MailSnooze.get(
      env.MailSnooze.idFromName(JSON.stringify([scope.mailboxId, scope.id]))
    );
    await stub.fetch("https://internal/mail-snooze/wake", {
      body: JSON.stringify(scope),
      method: "POST",
    });
    await runInDurableObject(stub, () => {
      configureServerEnv({ BETTER_AUTH_URL: "https://quieter.example" });
    });
    const started = Promise.withResolvers<null>();
    const finish = Promise.withResolvers<null>();
    const returnAt = Date.now() + 86_400_000;
    let dispatched = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        if (dispatched) {
          return Response.json({ nextWakeAt: returnAt });
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
    const wake = env.MailSnooze.get(stub.id)
      .fetch("https://internal/mail-snooze/wake", {
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
    await runDurableObjectAlarm(env.MailSnooze.get(stub.id));
    await expect(
      runInDurableObject(
        env.MailSnooze.get(stub.id),
        async (_instance, state) => await state.storage.getAlarm()
      )
    ).resolves.toBe(returnAt);
  });

  test("retains a recovery alarm when the dispatch endpoint fails", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "snooze-mailbox",
    };
    const stub = env.MailSnooze.get(
      env.MailSnooze.idFromName(JSON.stringify([scope.mailboxId, scope.id]))
    );
    await stub.fetch("https://internal/mail-snooze/wake", {
      body: JSON.stringify(scope),
      method: "POST",
    });
    await runInDurableObject(stub, () => {
      configureServerEnv({ BETTER_AUTH_URL: "https://quieter.example" });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(new Response(null, { status: 503 }))
      )
    );
    await expect(runDurableObjectAlarm(stub)).rejects.toThrow(Error);
    await evictDurableObject(stub);
    await expect(
      runInDurableObject(
        stub,
        async (_instance, state) => await state.storage.getAlarm()
      )
    ).resolves.not.toBeNull();
  });

  test("does not let another mailbox replace a stored clock scope", async () => {
    const scope = {
      id: crypto.randomUUID(),
      mailboxId: "snooze-original-mailbox",
    };
    const stub = env.MailSnooze.get(
      env.MailSnooze.idFromName(JSON.stringify([scope.mailboxId, scope.id]))
    );
    const accepted = await stub.fetch("https://internal/mail-snooze/wake", {
      body: JSON.stringify(scope),
      method: "POST",
    });
    expect(accepted.status).toBe(204);
    const rejected = await stub
      .fetch("https://internal/mail-snooze/wake", {
        body: JSON.stringify({ ...scope, mailboxId: "snooze-other-mailbox" }),
        method: "POST",
      })
      .catch(() => null);
    expect(rejected?.ok ?? false).toBeFalsy();
    await evictDurableObject(stub);
    await expect(
      runInDurableObject(
        stub,
        async (_instance, state) => await state.storage.get("scope")
      )
    ).resolves.toStrictEqual(scope);
  });
});
