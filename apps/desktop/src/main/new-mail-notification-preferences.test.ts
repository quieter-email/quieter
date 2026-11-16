import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { NewMailNotificationPreferenceService } from "./new-mail-notification-preferences";

describe("native new-mail preferences", () => {
  let directory: string;
  let session: { sessionId: string; userId: string } | null;

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(tmpdir(), "quieter-new-mail-preferences-")
    );
    session = { sessionId: "session-a", userId: "user-a" };
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  const createService = (
    options: Partial<
      ConstructorParameters<typeof NewMailNotificationPreferenceService>[0]
    > = {}
  ) =>
    new NewMailNotificationPreferenceService({
      filename: () => path.join(directory, "preferences.json"),
      getSession: async () => await Promise.resolve(session),
      isSupported: () => true,
      origin: "https://fixture.example.test",
      ...options,
    });

  test("keeps default opt-out and isolates durable preferences by account and mailbox", async () => {
    const service = createService();
    const scope = { mailboxId: "mailbox-a", userId: "user-a" };
    await expect(
      service.execute({ ...scope, kind: "get-status" }, () => true)
    ).resolves.toMatchObject({ enabled: false });
    await service.execute(
      { ...scope, enabled: true, kind: "set-enabled" },
      () => true
    );
    await expect(
      createService().execute({ ...scope, kind: "get-status" }, () => true)
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      service.execute(
        { ...scope, kind: "get-status", mailboxId: "mailbox-b" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: false });
    session = { sessionId: "session-b", userId: "user-b" };
    await expect(
      service.execute(
        { ...scope, kind: "get-status", userId: "user-b" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: false });
    const saved = await readFile(
      path.join(directory, "preferences.json"),
      "utf-8"
    );
    expect(saved).not.toContain("user-a");
    expect(saved).not.toContain("mailbox-a");
  });

  test("rejects a different account and a stale frame without enabling either scope", async () => {
    const service = createService();
    const scope = {
      enabled: true,
      kind: "set-enabled",
      mailboxId: "mailbox-a",
      userId: "user-b",
    } satisfies Parameters<NewMailNotificationPreferenceService["execute"]>[0];
    await expect(service.execute(scope, () => true)).resolves.toMatchObject({
      kind: "inactive",
    });
    await expect(
      service.execute({ ...scope, userId: "user-a" }, () => false)
    ).resolves.toMatchObject({ kind: "inactive" });
    await expect(
      service.execute(
        { kind: "get-status", mailboxId: scope.mailboxId, userId: "user-a" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: false });
  });

  test("does not reuse an initial session after account or session replacement", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    let captured = false;
    const service = createService({
      getSession: async () => {
        if (!captured) {
          captured = true;
          const initial = session;
          started.resolve(null);
          await release.promise;
          return initial;
        }
        return session;
      },
    });
    const pending = service.execute(
      {
        enabled: true,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-a",
      },
      () => true
    );
    await started.promise;
    session = { sessionId: "session-replaced", userId: "user-a" };
    release.resolve(null);
    await expect(pending).resolves.toMatchObject({ kind: "inactive" });
    await expect(
      service.execute(
        { kind: "get-status", mailboxId: "mailbox-a", userId: "user-a" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: false });
  });

  test("invalidates an in-flight operation when the native account context is cleared", async () => {
    const started = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const service = createService({
      getSession: async () => {
        started.resolve(null);
        await release.promise;
        return session;
      },
    });
    const pending = service.execute(
      {
        enabled: true,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-a",
      },
      () => true
    );
    await started.promise;
    service.invalidate();
    release.resolve(null);
    await expect(pending).resolves.toMatchObject({ kind: "inactive" });
    await expect(
      createService().execute(
        { kind: "get-status", mailboxId: "mailbox-a", userId: "user-a" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: false });
  });

  test("preserves independent mailbox changes when writes overlap", async () => {
    const service = createService();
    await Promise.all(
      ["mailbox-a", "mailbox-b"].map(
        async (mailboxId) =>
          await service.execute(
            { enabled: true, kind: "set-enabled", mailboxId, userId: "user-a" },
            () => true
          )
      )
    );
    const reloaded = createService();
    for (const mailboxId of ["mailbox-a", "mailbox-b"]) {
      await expect(
        reloaded.execute(
          { kind: "get-status", mailboxId, userId: "user-a" },
          () => true
        )
      ).resolves.toMatchObject({ enabled: true });
    }
  });

  test("does not enable memory after a failed write and recovers on a later attempt", async () => {
    const nested = path.join(directory, "missing");
    const service = createService({
      filename: () => path.join(nested, "preferences.json"),
    });
    const scope = { mailboxId: "mailbox-a", userId: "user-a" };
    await expect(
      service.execute(
        { ...scope, enabled: true, kind: "set-enabled" },
        () => true
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      service.execute({ ...scope, kind: "get-status" }, () => true)
    ).resolves.toMatchObject({ enabled: false });
    await mkdir(nested);
    await expect(
      service.execute(
        { ...scope, enabled: true, kind: "set-enabled" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: true });
  });

  test("does not overwrite malformed storage", async () => {
    const filename = path.join(directory, "preferences.json");
    await writeFile(filename, "invalid storage");
    const scope = {
      enabled: true,
      kind: "set-enabled",
      mailboxId: "mailbox-a",
      userId: "user-a",
    } satisfies Parameters<NewMailNotificationPreferenceService["execute"]>[0];
    await expect(
      createService().execute(scope, () => true)
    ).rejects.toBeInstanceOf(SyntaxError);
    await expect(readFile(filename, "utf-8")).resolves.toContain("invalid");
  });

  test("retains the saved opt-in separately from support and permits opting out while unsupported", async () => {
    const scope = { mailboxId: "mailbox-a", userId: "user-a" };
    await createService().execute(
      { ...scope, enabled: true, kind: "set-enabled" },
      () => true
    );
    const unsupported = createService({ isSupported: () => false });
    await expect(
      unsupported.execute({ ...scope, kind: "get-status" }, () => true)
    ).resolves.toMatchObject({ enabled: true, supported: false });
    await expect(
      unsupported.execute(
        { ...scope, enabled: false, kind: "set-enabled" },
        () => true
      )
    ).resolves.toMatchObject({ enabled: false, supported: false });
    await unsupported.execute(
      { ...scope, enabled: true, kind: "set-enabled" },
      () => true
    );
    await expect(
      createService().execute({ ...scope, kind: "get-status" }, () => true)
    ).resolves.toMatchObject({ enabled: false });
  });

  test.each(["inactive", "failed"])(
    "does not let an %s intermediate request release a preceding change",
    async (mode) => {
      const started = Promise.withResolvers<null>();
      const release = Promise.withResolvers<null>();
      let first = true;
      let failLookup = false;
      const service = createService({
        getSession: async () => {
          if (failLookup) {
            throw new Error("Fixture account lookup failed.");
          }
          if (first) {
            first = false;
            const initial = session;
            started.resolve(null);
            await release.promise;
            return initial;
          }
          return session;
        },
      });
      const scope = { mailboxId: "mailbox-a", userId: "user-a" };
      const preceding = service.execute(
        { ...scope, enabled: true, kind: "set-enabled" },
        () => true
      );
      await started.promise;
      failLookup = mode === "failed";
      const intermediate = (async () => {
        try {
          return await service.execute(
            { ...scope, kind: "get-status" },
            () => mode !== "inactive"
          );
        } catch {
          return null;
        }
      })();
      failLookup = false;
      const later = service.execute(
        { ...scope, enabled: false, kind: "set-enabled" },
        () => true
      );
      const finished = (async () => {
        await later;
        return true;
      })();
      try {
        await expect(
          Promise.race([finished, delay(30, false)])
        ).resolves.toBeFalsy();
      } finally {
        release.resolve(null);
      }
      await Promise.all([preceding, intermediate, later]);
      await expect(
        createService().execute({ ...scope, kind: "get-status" }, () => true)
      ).resolves.toMatchObject({ enabled: false });
    }
  );

  test("stops a pending account read without waiting for its provider response", async () => {
    const started = Promise.withResolvers<null>();
    const service = createService({
      getSession: async (signal) => {
        const pending = Promise.withResolvers<{
          sessionId: string;
          userId: string;
        } | null>();
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
    });
    const pending = service.execute(
      {
        enabled: true,
        kind: "set-enabled",
        mailboxId: "mailbox-a",
        userId: "user-a",
      },
      () => true
    );
    await started.promise;
    await service.stop();
    await expect(pending).resolves.toMatchObject({ kind: "inactive" });
  });
});
