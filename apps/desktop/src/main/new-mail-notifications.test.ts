import { readFileSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { NewMailNotificationPreferenceService } from "./new-mail-notification-preferences";
import { NewMailNotificationService } from "./new-mail-notifications";

class Popup extends EventTarget {
  private controller = new AbortController();

  on(event: "show" | "failed" | "click" | "close", listener: () => void): void {
    this.addEventListener(event, listener, { signal: this.controller.signal });
  }

  removeAllListeners(): void {
    this.controller.abort();
    this.controller = new AbortController();
  }

  closed = false;
  outcome: "show" | "failed" | "pending" | "throw" = "show";

  show(): void {
    if (this.outcome === "throw") {
      throw new Error("Fixture native display failure.");
    }
    if (this.outcome !== "pending") {
      this.dispatchEvent(new Event(this.outcome));
    }
  }

  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

describe("native new-mail delivery", () => {
  let directory: string;
  let session: { userId: string; sessionId: string } | null;
  let now: number;
  let foreground: boolean;
  let frameCurrent: boolean;
  let availability: "supported" | "unsupported" | "denied";
  let preferences: NewMailNotificationPreferenceService;
  let popups: Popup[];
  let errors: unknown[];
  let services: NewMailNotificationService[];

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(tmpdir(), "quieter-new-mail-delivery-")
    );
    session = { sessionId: "session-a", userId: "user-a" };
    now = Date.now();
    foreground = false;
    frameCurrent = true;
    availability = "supported";
    popups = [];
    errors = [];
    services = [];
    preferences = new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async () => await Promise.resolve(session),
      isSupported: () => availability !== "unsupported",
      origin: "https://fixture.example.test",
    });
    await preferences.execute(
      {
        enabled: true,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-a",
      },
      () => frameCurrent
    );
  });

  afterEach(async () => {
    for (const service of services) {
      await service.stop();
    }
    vi.useRealTimers();
    await rm(directory, { force: true, recursive: true });
  });

  const createService = (
    options: Partial<
      ConstructorParameters<typeof NewMailNotificationService>[0]
    > = {}
  ) => {
    const service = new NewMailNotificationService({
      availability: () => availability,
      createPopup: () => {
        const popup = new Popup();
        popups.push(popup);
        return popup;
      },
      filename: () => path.join(directory, "receipts.json"),
      isForeground: () => foreground,
      now: () => now,
      onError: (error) => {
        errors.push(error);
      },
      openOwnedIntent: async () => {
        await Promise.resolve();
      },
      preferences,
      ...options,
    });
    services.push(service);
    return service;
  };

  const capture = async (service: NewMailNotificationService) => {
    const result = await service.capture(
      { mailboxId: "mailbox-a", userId: "user-a" },
      () => frameCurrent
    );
    if (result.kind !== "enabled") {
      throw new Error("Fixture could not capture enabled native context.");
    }
    return {
      contextId: result.contextId,
      mailboxId: "mailbox-a",
      messageId: "message-a",
      receivedAt: new Date(now).toISOString(),
      threadId: "thread-a",
    };
  };

  test("persists a private handled receipt before popup construction and deduplicates stable identity after restart", async () => {
    const service = createService({
      createPopup: () => {
        const filename = path.join(directory, "receipts.json");
        // oxlint-disable-next-line node/no-sync -- Native popup construction is synchronous; inspect persistence at that boundary.
        const saved = readFileSync(filename, "utf-8");
        expect(saved).not.toContain("message-a");
        expect(saved).not.toContain("user-a");
        expect(saved).not.toContain("mailbox-a");
        const popup = new Popup();
        popups.push(popup);
        return popup;
      },
    });
    const input = await capture(service);
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "shown"
    );
    const stored = await stat(path.join(directory, "receipts.json"));
    expect(
      process.platform === "win32" || stored.mode % 0o1000 === 0o600
    ).toBeTruthy();
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "duplicate"
    );
    await service.stop();
    const restarted = createService();
    const freshContext = await capture(restarted);
    await expect(
      restarted.show(
        { ...input, contextId: freshContext.contextId },
        () => frameCurrent
      )
    ).resolves.toBe("duplicate");
    expect(popups).toHaveLength(1);
  });

  test("serializes concurrent receipt decisions without losing independent messages", async () => {
    const service = createService();
    const input = await capture(service);
    const results = await Promise.all([
      service.show(input, () => frameCurrent),
      service.show({ ...input }, () => frameCurrent),
      service.show({ ...input, messageId: "message-b" }, () => frameCurrent),
    ]);
    expect(results).toContain("duplicate");
    expect(results).toContain("shown");
    await service.stop();
    const restarted = createService();
    const next = await capture(restarted);
    for (const messageId of ["message-a", "message-b"]) {
      await expect(
        restarted.show({ ...next, messageId }, () => true)
      ).resolves.toBe("duplicate");
    }
  });

  test("keeps foreground and burst suppression handled without a popup backlog", async () => {
    const service = createService();
    const input = await capture(service);
    foreground = true;
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "quiet"
    );
    foreground = false;
    await expect(
      service.show({ ...input, messageId: "message-b" }, () => frameCurrent)
    ).resolves.toBe("quiet");
    expect(popups).toHaveLength(0);
    now += 61_000;
    await expect(
      service.show(
        {
          ...input,
          messageId: "message-c",
          receivedAt: new Date(now).toISOString(),
        },
        () => frameCurrent
      )
    ).resolves.toBe("shown");
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "duplicate"
    );
    expect(popups).toHaveLength(1);
  });

  test.each(["account", "session", "frame", "generation"])(
    "rejects the old context after %s replacement during passive eligibility",
    async (replacement) => {
      const service = createService();
      const input = await capture(service);
      if (replacement === "account") {
        session = { sessionId: "session-b", userId: "user-b" };
      } else if (replacement === "session") {
        session = { sessionId: "session-replaced", userId: "user-a" };
      } else if (replacement === "frame") {
        frameCurrent = false;
      } else {
        preferences.invalidate();
      }
      await expect(service.show(input, () => frameCurrent)).resolves.toBe(
        "inactive"
      );
      expect(popups).toHaveLength(0);
    }
  );

  test("binds the context to its original mailbox and rejects content-bearing IPC input", async () => {
    const service = createService();
    const input = await capture(service);
    await expect(
      service.show({ ...input, mailboxId: "mailbox-b" }, () => frameCurrent)
    ).resolves.toBe("inactive");
    await expect(
      service.show({ ...input, subject: "private content" }, () => frameCurrent)
    ).rejects.toThrow(/unrecognized|invalid|expected/iu);
    await expect(
      service.capture(
        { mailboxId: "mailbox-a", userId: "user-b" },
        () => frameCurrent
      )
    ).resolves.toMatchObject({ kind: "inactive" });
    expect(popups).toHaveLength(0);
  });

  test("rejects stale and implausibly future arrivals without accepting them", async () => {
    const service = createService();
    const input = await capture(service);
    for (const receivedAt of [
      new Date(now - 24 * 60 * 60_000),
      new Date(now + 24 * 60 * 60_000),
    ]) {
      await expect(
        service.show(
          { ...input, receivedAt: receivedAt.toISOString() },
          () => true
        )
      ).resolves.toBe("stale");
    }
    expect(popups).toHaveLength(0);
  });

  test("does not let an arrival that becomes stale during final authority validation suppress fresh mail", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const filename = path.join(directory, "receipts.json");
    let pauseAfterReceipt = true;
    const owner = new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async () => {
        if (pauseAfterReceipt) {
          let receiptExists = false;
          try {
            await stat(filename);
            receiptExists = true;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "ENOENT"
            ) {
              throw error;
            }
          }
          if (receiptExists) {
            started.resolve(null);
            await release.promise;
          }
        }
        return session;
      },
      isSupported: () => true,
      origin: "https://fixture.example.test",
    });
    const service = createService({ preferences: owner });
    const input = await capture(service);
    const pending = service.show(
      { ...input, receivedAt: new Date(now - 299_000).toISOString() },
      () => frameCurrent
    );
    await started.promise;
    now += 2000;
    pauseAfterReceipt = false;
    release.resolve(null);
    await expect(pending).resolves.toBe("stale");
    await expect(
      service.show(
        {
          ...input,
          messageId: "fresh-message",
          receivedAt: new Date(now).toISOString(),
        },
        () => frameCurrent
      )
    ).resolves.toBe("shown");
    expect(popups).toHaveLength(1);
  });

  test("fails closed at protected receipt capacity and cannot revive an expired accepted replay after clock rollback", async () => {
    foreground = true;
    const service = createService({ receiptCapacity: 1 });
    const original = await capture(service);
    await expect(service.show(original, () => frameCurrent)).resolves.toBe(
      "quiet"
    );
    await expect(
      service.show({ ...original, messageId: "message-b" }, () => frameCurrent)
    ).resolves.toBe("blocked");
    const originalClock = now;
    now += 24 * 60 * 60_000;
    await expect(
      service.show(
        {
          ...original,
          messageId: "message-c",
          receivedAt: new Date(now).toISOString(),
        },
        () => frameCurrent
      )
    ).resolves.toBe("quiet");
    await service.stop();
    now = originalClock;
    const restarted = createService();
    const next = await capture(restarted);
    await expect(
      restarted.show(
        { ...original, contextId: next.contextId },
        () => frameCurrent
      )
    ).resolves.toBe("stale");
    expect(popups).toHaveLength(0);
  });

  test("recovers for fresh arrivals after failed persistence without showing the failed event", async () => {
    const missing = path.join(directory, "missing");
    const service = createService({
      filename: () => path.join(missing, "receipts.json"),
    });
    const input = await capture(service);
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "blocked"
    );
    expect(popups).toHaveLength(0);
    await mkdir(missing);
    now += 61_000;
    await expect(
      service.show(
        {
          ...input,
          messageId: "message-b",
          receivedAt: new Date(now).toISOString(),
        },
        () => frameCurrent
      )
    ).resolves.toBe("shown");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("preserves corrupt storage and fails closed", async () => {
    const filename = path.join(directory, "receipts.json");
    await writeFile(filename, "invalid storage");
    const service = createService();
    await expect(
      service.show(await capture(service), () => frameCurrent)
    ).resolves.toBe("blocked");
    await expect(readFile(filename, "utf-8")).resolves.toContain("invalid");
    expect(popups).toHaveLength(0);
  });

  test.each(["failed", "throw", "construct"])(
    "keeps a %s native attempt handled while permitting a later fresh message",
    async (failure) => {
      let failing = true;
      const service = createService({
        createPopup: () => {
          if (failing && failure === "construct") {
            throw new Error("Fixture native construction failure.");
          }
          const popup = new Popup();
          if (failing) {
            popup.outcome = failure === "throw" ? "throw" : "failed";
          }
          popups.push(popup);
          return popup;
        },
      });
      const input = await capture(service);
      await expect(service.show(input, () => frameCurrent)).resolves.toBe(
        "blocked"
      );
      failing = false;
      now += 61_000;
      await expect(
        service.show(
          {
            ...input,
            messageId: "message-b",
            receivedAt: new Date(now).toISOString(),
          },
          () => frameCurrent
        )
      ).resolves.toBe("shown");
      await expect(service.show(input, () => frameCurrent)).resolves.toBe(
        "duplicate"
      );
      expect(errors.length).toBeGreaterThan(0);
    }
  );

  test("distinguishes saved opt-out, unsupported native support and known permission denial", async () => {
    const service = createService();
    const scope = { mailboxId: "mailbox-a", userId: "user-a" };
    availability = "denied";
    await expect(
      service.capture(scope, () => frameCurrent)
    ).resolves.toMatchObject({ kind: "blocked" });
    availability = "unsupported";
    await expect(
      service.capture(scope, () => frameCurrent)
    ).resolves.toMatchObject({ kind: "unsupported" });
    await preferences.execute(
      { ...scope, enabled: false, kind: "set-enabled" },
      () => frameCurrent
    );
    await expect(
      service.capture(scope, () => frameCurrent)
    ).resolves.toMatchObject({ kind: "disabled" });
  });

  test("opt-out closes only this service's retained popups and invalidates its context", async () => {
    const unrelated = new Popup();
    const service = createService();
    const input = await capture(service);
    await service.show(input, () => frameCurrent);
    await preferences.execute(
      {
        enabled: false,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-a",
      },
      () => frameCurrent
    );
    expect(popups.every((popup) => popup.closed)).toBeTruthy();
    expect(unrelated.closed).toBeFalsy();
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "inactive"
    );
  });

  test("hands clicks the original main-private owner and prevents a delayed handoff from adopting a replacement account", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const opened: string[] = [];
    let originalOwner: { userId: string; sessionId: string } | undefined;
    let originalMessage: string | undefined;
    const service = createService({
      openOwnedIntent: async ({ owner, isCurrent, signal, target }) => {
        originalOwner = owner;
        originalMessage = target.messageId;
        started.resolve(null);
        await release.promise;
        if (
          isCurrent() &&
          !signal.aborted &&
          session?.userId === owner.userId &&
          session.sessionId === owner.sessionId
        ) {
          opened.push(owner.userId);
        }
      },
    });
    await service.show(await capture(service), () => frameCurrent);
    popups[0]?.dispatchEvent(new Event("click"));
    await started.promise;
    expect(originalOwner).toMatchObject({
      sessionId: "session-a",
      userId: "user-a",
    });
    expect(originalMessage).toBe("message-a");
    session = { sessionId: "session-b", userId: "user-b" };
    preferences.invalidate();
    release.resolve(null);
    await service.stop();
    expect(opened).toHaveLength(0);
  });

  test("stops and drains a pending native display without waiting for a native response", async () => {
    const attempted = Promise.withResolvers<null>();
    const service = createService({
      createPopup: () => {
        const popup = new Popup();
        popup.outcome = "pending";
        popups.push(popup);
        attempted.resolve(null);
        return popup;
      },
    });
    const pending = service.show(await capture(service), () => frameCurrent);
    await attempted.promise;
    await service.stop();
    await expect(pending).resolves.toBe("inactive");
    expect(popups.every((popup) => popup.closed)).toBeTruthy();
  });

  test("cancels and drains a pending authority read on stop", async () => {
    const started = Promise.withResolvers<null>();
    const pendingPreferences = new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async (signal) => {
        const pending = Promise.withResolvers<null>();
        signal.addEventListener(
          "abort",
          () => {
            pending.reject(signal.reason);
          },
          { once: true }
        );
        started.resolve(null);
        return await pending.promise;
      },
      isSupported: () => true,
      origin: "https://fixture.example.test",
    });
    const service = createService({ preferences: pendingPreferences });
    const pending = service.capture(
      { mailboxId: "mailbox-a", userId: "user-a" },
      () => frameCurrent
    );
    await started.promise;
    await service.stop();
    await expect(pending).resolves.toMatchObject({ kind: "inactive" });
  });

  test("rejects capture overflow promptly while authority waits, drains on stop and recovers", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    let holding = true;
    let observedSignal: AbortSignal | undefined;
    const owner = new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async (signal) => {
        if (holding) {
          if (observedSignal !== signal) {
            observedSignal = signal;
            signal.addEventListener(
              "abort",
              () => {
                release.resolve(null);
              },
              { once: true }
            );
          }
          started.resolve(null);
          await release.promise;
        }
        return session;
      },
      isSupported: () => true,
      origin: "https://fixture.example.test",
    });
    const service = createService({ preferences: owner });
    const responses: string[] = [];
    const pending = Array.from({ length: 512 }, async () => {
      const result = await service.capture(
        { mailboxId: "mailbox-a", userId: "user-a" },
        () => frameCurrent
      );
      responses.push(result.kind);
      return result;
    });
    await started.promise;
    await vi.waitFor(() => {
      expect(responses).toContain("blocked");
      expect(responses.length).toBeLessThan(pending.length);
    });
    await service.stop();
    const drained = await Promise.all(pending);
    expect(drained).toContainEqual({ kind: "inactive" });
    expect(drained.every((result) => result.kind !== "enabled")).toBeTruthy();
    holding = false;
    const recovered = createService({ preferences: owner });
    await expect(
      recovered.show(await capture(recovered), () => frameCurrent)
    ).resolves.toBe("shown");
  });

  test.each(["another account", "sign-out"])(
    "invalidates an old context when a different mailbox capture observes %s",
    async (replacement) => {
      await preferences.execute(
        {
          enabled: true,
          kind: "set-enabled",
          mailboxId: "mailbox-b",
          userId: "user-a",
        },
        () => frameCurrent
      );
      const service = createService();
      const input = await capture(service);
      const original = session;
      session =
        replacement === "sign-out"
          ? null
          : { sessionId: "session-b", userId: "user-b" };
      await expect(
        service.capture(
          { mailboxId: "mailbox-b", userId: "user-a" },
          () => frameCurrent
        )
      ).resolves.toMatchObject({ kind: "inactive" });
      session = original;
      await expect(service.show(input, () => frameCurrent)).resolves.toBe(
        "inactive"
      );
      expect(popups).toHaveLength(0);
      await expect(
        service.show(await capture(service), () => frameCurrent)
      ).resolves.toBe("shown");
    }
  );

  test("does not let an obsolete mismatched capture invalidate a new current actor", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    let pause = false;
    const owner = new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async () => {
        const original = session;
        if (pause) {
          pause = false;
          started.resolve(null);
          await release.promise;
        }
        return original;
      },
      isSupported: () => true,
      origin: "https://fixture.example.test",
    });
    await owner.execute(
      {
        enabled: true,
        kind: "set-enabled",
        mailboxId: "mailbox-b",
        userId: "user-a",
      },
      () => frameCurrent
    );
    const service = createService({ preferences: owner });
    const input = await capture(service);
    session = { sessionId: "session-b", userId: "user-b" };
    pause = true;
    const pending = service.capture(
      { mailboxId: "mailbox-b", userId: "user-a" },
      () => frameCurrent
    );
    await started.promise;
    owner.invalidate();
    await owner.execute(
      {
        enabled: true,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-b",
      },
      () => frameCurrent
    );
    const current = await service.capture(
      { mailboxId: "mailbox-a", userId: "user-b" },
      () => frameCurrent
    );
    expect(current.kind).toBe("enabled");
    release.resolve(null);
    await expect(pending).resolves.toMatchObject({ kind: "inactive" });
    if (current.kind !== "enabled") {
      throw new Error("Fixture could not capture the new actor.");
    }
    await expect(
      service.show({ ...input, contextId: current.contextId }, () => true)
    ).resolves.toBe("shown");
  });

  test("rejects account replacement while an actual authority lookup is awaiting", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    let pause = false;
    const owner = new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async () => {
        const original = session;
        if (pause) {
          started.resolve(null);
          await release.promise;
        }
        return original;
      },
      isSupported: () => true,
      origin: "https://fixture.example.test",
    });
    const service = createService({ preferences: owner });
    const input = await capture(service);
    pause = true;
    const pending = service.show(input, () => frameCurrent);
    await started.promise;
    session = { sessionId: "session-b", userId: "user-b" };
    release.resolve(null);
    await expect(pending).resolves.toBe("inactive");
    expect(popups).toHaveLength(0);
  });

  test("settles a native display timeout as blocked and keeps its receipt handled", async () => {
    const attempted = Promise.withResolvers<null>();
    const service = createService({
      createPopup: () => {
        vi.useFakeTimers();
        const popup = new Popup();
        popup.outcome = "pending";
        popups.push(popup);
        attempted.resolve(null);
        return popup;
      },
    });
    const input = await capture(service);
    const pending = service.show(input, () => frameCurrent);
    await attempted.promise;
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("blocked");
    vi.useRealTimers();
    await expect(service.show(input, () => frameCurrent)).resolves.toBe(
      "duplicate"
    );
    expect(popups.every((popup) => popup.closed)).toBeTruthy();
  });

  test("rejects noncanonical timestamps before native receipt handling", async () => {
    const service = createService();
    const input = await capture(service);
    for (const receivedAt of [
      "2026-11-16T10:00:00.000+01:00",
      "2026-11-16T10:00:00Z",
      "2026-02-30T10:00:00.000Z",
    ]) {
      await expect(
        service.show({ ...input, receivedAt }, () => true)
      ).rejects.toThrow(/unrecognized|invalid|expected/iu);
    }
    expect(popups).toHaveLength(0);
  });

  test("recovers a fresh context after detecting same-account session replacement", async () => {
    const service = createService();
    const oldInput = await capture(service);
    session = { sessionId: "new-session-a", userId: "user-a" };
    await expect(service.show(oldInput, () => frameCurrent)).resolves.toBe(
      "inactive"
    );
    const newInput = await capture(service);
    await expect(
      service.show({ ...newInput, messageId: "message-b" }, () => frameCurrent)
    ).resolves.toBe("shown");
    await expect(service.show(oldInput, () => frameCurrent)).resolves.toBe(
      "inactive"
    );
  });

  test("keeps repeated default-off captures quiet without retaining a native context", async () => {
    await preferences.execute(
      {
        enabled: false,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-a",
      },
      () => frameCurrent
    );
    const service = createService();
    for (const mailboxId of ["mailbox-a", "mailbox-b"]) {
      await expect(
        service.capture({ mailboxId, userId: "user-a" }, () => true)
      ).resolves.toMatchObject({ kind: "disabled" });
    }
    expect(popups).toHaveLength(0);
  });
});
