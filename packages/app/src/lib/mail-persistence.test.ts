import "fake-indexeddb/auto";
import { mailCache } from "@quieter/app/lib/mail-cache";
import { pendingMailMutations } from "@quieter/app/lib/mail-mutation-state";
import { runMailMutation } from "@quieter/app/lib/mail-mutations";
import { persistQueryKeys } from "@quieter/app/lib/mail/inbox-query/query-cache";
import {
  clearQueryPersistence,
  queryPersister,
  setQueryPersistenceUser,
} from "@quieter/app/lib/query-persister";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

describe("mail content persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { length: 0 } });
  });
  afterEach(() => {
    setQueryPersistenceUser(undefined);
    vi.unstubAllGlobals();
  });

  test("a login after committed logout survives the sender completing", async () => {
    const client = new QueryClient();
    setQueryPersistenceUser("one", client, crypto.randomUUID());
    const key = ["message-thread", 3, "mailbox", "thread"];
    client.setQueryData(key, {
      messages: [{ bodyText: "old private body", id: "message" }],
    });
    await queryPersister.persistQueryByKey(key, client);
    const committed = Promise.withResolvers<null>();
    const resume = Promise.withResolvers<null>();
    const clear = mailCache.clear.bind(mailCache);
    const cleanup = vi
      .spyOn(mailCache, "clear")
      .mockImplementation(async () => {
        await clear();
        committed.resolve(null);
        await resume.promise;
      });
    try {
      const logout = clearQueryPersistence();
      await committed.promise;
      const fresh = new QueryClient();
      const session = crypto.randomUUID();
      setQueryPersistenceUser("one", fresh, session);
      fresh.setQueryData(key, {
        messages: [{ bodyText: "fresh private body", id: "message" }],
      });
      await queryPersister.persistQueryByKey(key, fresh);
      resume.resolve(null);
      await logout;
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(key))
      ).resolves.toMatchObject({
        messages: [{ bodyText: "fresh private body" }],
      });
      expect(client.getQueryData(key)).toBeUndefined();
      const reload = new QueryClient();
      setQueryPersistenceUser("one", reload, session);
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(key))
      ).resolves.toMatchObject({
        messages: [{ bodyText: "fresh private body" }],
      });
    } finally {
      resume.resolve(null);
      cleanup.mockRestore();
    }
  });

  test.each([false, true])(
    "flushes retained list keys after the final mutation settles, failure: %s",
    async (fails) => {
      const client = new QueryClient();
      setQueryPersistenceUser(crypto.randomUUID(), client);
      const key = ["messages", "mailbox", "inbox", ""];
      const before = {
        pageParams: [null],
        pages: [{ messages: [{ id: "message", isUnread: true }] }],
      };
      const after = {
        pageParams: [null],
        pages: [{ messages: [{ id: "message", isUnread: false }] }],
      };
      client.setQueryData(key, before);
      await persistQueryKeys(client, [key]);
      const first = runMailMutation(client, {
        apply: () => {
          client.setQueryData(key, after);
        },
        execute: async () =>
          await Promise.resolve(() => {
            client.setQueryData(key, after);
          }),
        mailboxId: "mailbox",
        targets: ["first"],
      });
      const deferred = Promise.withResolvers<() => void>();
      const last = runMailMutation(client, {
        apply: () => {},
        execute: async () => await deferred.promise,
        mailboxId: "mailbox",
        targets: ["last"],
      });
      const outcome = last.catch(() => {});
      await first;
      await persistQueryKeys(client, [key]);
      const hash = JSON.stringify(key);
      await expect(queryPersister.retrieveQuery(hash)).resolves.toStrictEqual(
        before
      );
      if (fails) {
        deferred.reject(new Error("rejected"));
      } else {
        deferred.resolve(() => {});
      }
      await outcome;
      await vi.waitFor(async () => {
        await expect(queryPersister.retrieveQuery(hash)).resolves.toStrictEqual(
          after
        );
      });
      client.clear();
    }
  );

  test("separates message bodies from thread metadata and falls back if a body was evicted", async () => {
    const client = new QueryClient();
    setQueryPersistenceUser(crypto.randomUUID(), client);
    const key = ["message-thread", 3, "mailbox", "thread"];
    client.setQueryData(key, {
      messages: [
        {
          bodyText: "Cached body",
          id: "message",
          labelIds: ["INBOX"],
          raw: "exclude raw data",
        },
      ],
    });
    await queryPersister.persistQueryByKey(key, client);
    const hash = JSON.stringify(key);
    await vi.waitFor(async () => {
      await expect(
        mailCache.getItem(`quieter-cache-${hash}`)
      ).resolves.not.toBeNull();
    });
    const metadata = await mailCache.getItem(`quieter-cache-${hash}`);
    expect(metadata).not.toContain("Cached body");
    expect(metadata).not.toContain("exclude raw data");
    const restored = await queryPersister.retrieveQuery<{
      messages: { bodyText: string }[];
    }>(hash);
    expect(restored?.messages[0].bodyText).toBe("Cached body");
    await mailCache.removeItem('body-["mailbox","message"]');
    await expect(queryPersister.retrieveQuery(hash)).resolves.toBeUndefined();
  });

  test("settles writes when a restored thread refresh is cancelled and preserves the next refresh", async () => {
    const client = new QueryClient();
    setQueryPersistenceUser(crypto.randomUUID(), client);
    const key = ["message-thread", 3, "mailbox", "thread"];
    const before = {
      messages: [{ bodyText: "Cached body", id: "message", isUnread: true }],
    };
    const confirmed = {
      messages: [{ ...before.messages[0], isUnread: false }],
    };
    client.setQueryData(key, before, { updatedAt: Date.now() - 60_000 });
    await queryPersister.persistQueryByKey(key, client);
    await vi.waitFor(async () => {
      await expect(
        queryPersister.retrieveQuery(JSON.stringify(key))
      ).resolves.toMatchObject(before);
    });
    client.removeQueries({ exact: true, queryKey: key });
    const interrupted = Promise.withResolvers<typeof before>();
    const fetchThread = vi
      .fn<() => Promise<typeof before>>()
      .mockReturnValueOnce(interrupted.promise)
      .mockResolvedValue({
        messages: [
          ...confirmed.messages,
          { bodyText: "Incoming body", id: "incoming", isUnread: true },
        ],
      });
    const thread = new QueryObserver(client, {
      persister: queryPersister.persisterFn,
      queryFn: fetchThread,
      queryKey: key,
      retry: false,
    });
    const unsubscribe = thread.subscribe(() => {});
    try {
      await vi.waitFor(() => {
        expect(fetchThread).toHaveBeenCalledOnce();
      });
      const refreshing = thread.refetch({ cancelRefetch: false });
      await runMailMutation(client, {
        apply: () => {
          client.setQueryData(key, confirmed);
        },
        execute: async () =>
          await Promise.resolve(() => {
            client.setQueryData(key, confirmed);
          }),
        mailboxId: "mailbox",
        targets: ["thread"],
      });
      const refreshed = await refreshing;
      expect(refreshed.isError).toBeFalsy();
      interrupted.resolve(before);
      await vi.waitFor(() => {
        const messages = client.getQueryData<typeof before>(key)?.messages;
        expect(messages).toContainEqual(
          expect.objectContaining({ id: "message", isUnread: false })
        );
        expect(messages).toContainEqual(
          expect.objectContaining({ id: "incoming" })
        );
      });
      expect(pendingMailMutations.get(client)?.has("mailbox")).toBeFalsy();
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  test("does not persist optimistic state and purges a revoked mailbox without evicting another mailbox", async () => {
    const client = new QueryClient();
    setQueryPersistenceUser(crypto.randomUUID(), client);
    const key = ["message-thread", 3, "mailbox", "thread"];
    client.setQueryData(key, {
      messages: [{ bodyText: "Confirmed", id: "message", labelIds: [] }],
    });
    await queryPersister.persistQueryByKey(key, client);
    const hash = JSON.stringify(key);
    await vi.waitFor(async () => {
      await expect(
        mailCache.getItem(`quieter-cache-${hash}`)
      ).resolves.not.toBeNull();
    });
    pendingMailMutations.set(client, new Set(["mailbox"]));
    client.setQueryData(key, {
      messages: [
        { bodyText: "Confirmed", id: "message", labelIds: ["optimistic"] },
      ],
    });
    await queryPersister.persistQueryByKey(key, client);
    await expect(
      mailCache.getItem(`quieter-cache-${hash}`)
    ).resolves.not.toContain("optimistic");
    await mailCache.setItem('body-["another","message"]', "Other mailbox");
    await mailCache.removeMailbox("mailbox");
    await expect(
      mailCache.getItem(`quieter-cache-${hash}`)
    ).resolves.toBeNull();
    await expect(
      mailCache.getItem('body-["mailbox","message"]')
    ).resolves.toBeNull();
    await expect(mailCache.getItem('body-["another","message"]')).resolves.toBe(
      "Other mailbox"
    );
  });
});
