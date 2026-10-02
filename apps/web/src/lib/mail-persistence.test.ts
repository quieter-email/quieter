import "fake-indexeddb/auto";
import { QueryClient } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { mailCache } from "./mail-cache";
import { pendingMailMutations } from "./mail-mutation-state";
import { runMailMutation } from "./mail-mutations";
import { persistQueryKeys } from "./mail/inbox-query/query-cache";
import { queryPersister, setQueryPersistenceUser } from "./query-persister";

describe("mail content persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { length: 0 } });
  });
  afterEach(() => {
    setQueryPersistenceUser(undefined);
    vi.unstubAllGlobals();
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
