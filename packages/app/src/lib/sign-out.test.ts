import "fake-indexeddb/auto";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import { signOut } from "@quieter/app/lib/auth";
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
    configureAppRuntime({ fetch: request });
    vi.stubGlobal("window", {
      localStorage: { length: 0 },
      location: { href: "https://example.test" },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearQueryPersistence();
    vi.unstubAllGlobals();
    configureAppRuntime({});
  });

  test.each(["rejected", "network"])(
    "retains usable same-user persistence when sign-out fails with %s",
    async (failure) => {
      const client = new QueryClient();
      const userId = crypto.randomUUID();
      setQueryPersistenceUser(userId, client);
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
    setQueryPersistenceUser(crypto.randomUUID(), oldClient);
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
    setQueryPersistenceUser(crypto.randomUUID(), client);
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
    setQueryPersistenceUser(crypto.randomUUID(), client);
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
    setQueryPersistenceUser(crypto.randomUUID(), new QueryClient());
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
