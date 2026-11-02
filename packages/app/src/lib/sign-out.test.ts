import "fake-indexeddb/auto";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import { signOut } from "@quieter/app/lib/auth";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { mailCache } from "@quieter/app/lib/mail-cache";
import { runMailMutation } from "@quieter/app/lib/mail-mutations";
import {
  clearQueryPersistence,
  queryPersister,
  setQueryPersistenceUser,
} from "@quieter/app/lib/query-persister";
import { configureAppRuntime } from "@quieter/app/runtime";
import { QueryClient } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const request = vi.fn<typeof fetch>();

describe("authenticated sign-out cache boundary", () => {
  beforeEach(() => {
    request.mockReset();
    configureAppRuntime({ fetch: request });
    vi.stubGlobal("localStorage", { length: 0 });
    vi.stubGlobal("window", {
      localStorage: { length: 0 },
      location: { href: "https://example.test" },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await draftRecoveryJournal.setUser(undefined);
    await clearQueryPersistence();
    vi.unstubAllGlobals();
    configureAppRuntime({});
  });

  test.each(["absent", "retired", "read-denied"])(
    "does not contact the provider when query cleanup authority is %s",
    async (authority) => {
      const client = new QueryClient();
      const userId = crypto.randomUUID();
      setQueryPersistenceUser(userId, client);
      await draftRecoveryJournal.setUser(userId);
      await mailCache.setItem("body-message", "private");
      if (authority === "absent") {
        vi.spyOn(mailCache, "captureCleanup").mockImplementation(
          vi.fn<typeof mailCache.captureCleanup>()
        );
      } else if (authority === "retired") {
        await mailCache.clearSession();
      } else {
        vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(() => {
          throw new DOMException("denied", "UnknownError");
        });
      }
      const cleanup = vi.fn<() => Promise<void>>(
        draftRecoveryJournal.captureCleanup()
      );
      vi.spyOn(draftRecoveryJournal, "captureCleanup").mockReturnValue(cleanup);
      await expect(signOut()).rejects.toThrow(/loading|denied/u);
      expect(request).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      client.clear();
    }
  );

  test.each(["rejected", "network"])(
    "retains usable same-user persistence when sign-out fails with %s",
    async (failure) => {
      const client = new QueryClient();
      const userId = crypto.randomUUID();
      setQueryPersistenceUser(userId, client);
      await draftRecoveryJournal.setUser(userId);
      await mailCache.setItem("body-message", "private");
      if (failure === "network") {
        request.mockRejectedValueOnce(new Error("offline"));
      } else {
        request.mockResolvedValueOnce(
          Response.json(
            { message: "rejected" },
            {
              headers: { "content-type": "application/json" },
              status: 400,
            }
          )
        );
      }
      await expect(signOut()).rejects.toThrow(/offline|rejected/u);
      await expect(mailCache.getItem("body-message")).resolves.toBe("private");
      await mailCache.setItem("body-message", "updated private body");
      await expect(mailCache.getItem("body-message")).resolves.toBe(
        "updated private body"
      );
      client.clear();
    }
  );

  test("removes bodies before success and rejects an old client's late persistence after another login", async () => {
    const oldClient = new QueryClient();
    const userId = crypto.randomUUID();
    setQueryPersistenceUser(userId, oldClient);
    await draftRecoveryJournal.setUser(userId);
    const key = ["message-thread", 3, "mailbox", "thread"];
    oldClient.setQueryData(key, {
      messages: [{ bodyText: "private", id: "message" }],
    });
    await queryPersister.persistQueryByKey(key, oldClient);
    await expect(
      mailCache.getItem('body-["mailbox","message"]')
    ).resolves.not.toBeNull();
    request.mockResolvedValueOnce(
      Response.json(
        { success: true },
        {
          headers: { "content-type": "application/json" },
        }
      )
    );
    await signOut();
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    const newClient = new QueryClient();
    setQueryPersistenceUser(crypto.randomUUID(), newClient);
    await expect(
      mailCache.getItem('body-["mailbox","message"]')
    ).resolves.toBeNull();
    oldClient.setQueryData(key, {
      messages: [{ bodyText: "late private body", id: "message" }],
    });
    await queryPersister.persistQueryByKey(key, oldClient);
    await expect(
      mailCache.getItem('body-["mailbox","message"]')
    ).resolves.toBeNull();
    oldClient.clear();
    newClient.clear();
  });

  test("revokes serialization already waiting for a body when sign-out completes", async () => {
    const client = new QueryClient();
    const userId = crypto.randomUUID();
    setQueryPersistenceUser(userId, client);
    await draftRecoveryJournal.setUser(userId);
    const key = ["message-thread", 3, "mailbox", "thread"];
    client.setQueryData(key, {
      messages: [{ bodyText: "pending private body", id: "message" }],
    });
    const started = Promise.withResolvers<null>();
    const interrupted = Promise.withResolvers<null>();
    const read = vi
      .spyOn(mailCache, "getItem")
      .mockImplementationOnce(async () => {
        started.resolve(null);
        return await interrupted.promise;
      });
    const writing = queryPersister.persistQueryByKey(key, client);
    await started.promise;
    request.mockResolvedValueOnce(Response.json({ success: true }));
    await signOut();
    const next = new QueryClient();
    setQueryPersistenceUser(crypto.randomUUID(), next);
    interrupted.resolve(null);
    await writing;
    read.mockRestore();
    await expect(
      mailCache.getItem('body-["mailbox","message"]')
    ).resolves.toBeNull();
    await expect(
      queryPersister.retrieveQuery(JSON.stringify(key))
    ).resolves.toBeUndefined();
    next.clear();
  });

  test("prevents a pending mutation from restoring private query data after sign-out", async () => {
    const client = new QueryClient();
    const userId = crypto.randomUUID();
    setQueryPersistenceUser(userId, client);
    await draftRecoveryJournal.setUser(userId);
    const key = ["message-thread", 3, "mailbox", "thread"];
    client.setQueryData(key, {
      messages: [{ bodyText: "private body", id: "message" }],
    });
    const started = Promise.withResolvers<null>();
    const interrupted = Promise.withResolvers<() => void>();
    const mutation = runMailMutation(client, {
      apply: () => {},
      execute: async () => {
        started.resolve(null);
        return await interrupted.promise;
      },
      mailboxId: "mailbox",
      targets: ["message"],
    });
    const outcome = (async () => {
      try {
        await mutation;
        return null;
      } catch (error) {
        return error;
      }
    })();
    await started.promise;
    request.mockResolvedValueOnce(Response.json({ success: true }));
    await signOut();
    await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
    interrupted.resolve(() => {
      client.setQueryData(key, {
        messages: [{ bodyText: "late private body", id: "message" }],
      });
    });
    await waitForImmediate();
    expect(client.getQueryData(key)).toBeUndefined();
  });

  test("does not report successful sign-out when durable cleanup fails", async () => {
    const userId = crypto.randomUUID();
    setQueryPersistenceUser(userId, new QueryClient());
    await draftRecoveryJournal.setUser(userId);
    await mailCache.setItem("body-message", "private");
    request.mockResolvedValueOnce(
      Response.json(
        { success: true },
        {
          headers: { "content-type": "application/json" },
        }
      )
    );
    const clear = vi
      .spyOn(IDBObjectStore.prototype, "clear")
      .mockImplementation(() => {
        throw new DOMException("denied", "UnknownError");
      });
    await expect(signOut()).rejects.toBeInstanceOf(AggregateError);
    clear.mockRestore();
    await expect(mailCache.getItem("body-message")).resolves.toBeNull();
  });
});
