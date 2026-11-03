import { setImmediate as settleScheduledTasks } from "node:timers/promises";

import "fake-indexeddb/auto";
import { mailCache } from "@quieter/app/lib/mail-cache";
import {
  queryPersister,
  setQueryPersistenceUser,
} from "@quieter/app/lib/query-persister";
import {
  InfiniteQueryObserver,
  notifyManager,
  QueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

type MessagePage = { messages: { id: string }[] };

const queryKey = ["messages", "mailbox", "inbox", ""];
let client: QueryClient;
let scheduled: (() => void)[];

describe("persisted query refresh lifecycle", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", { localStorage: { length: 0 } });
    client = new QueryClient({
      defaultOptions: { queries: { persister: queryPersister.persisterFn } },
    });
    setQueryPersistenceUser(crypto.randomUUID(), client);
    client.setQueryData(
      queryKey,
      {
        pageParams: [null],
        pages: [{ messages: [{ id: "cached" }] }],
      },
      { updatedAt: Date.now() - 60_000 }
    );
    await queryPersister.persistQueryByKey(queryKey, client);
    client.removeQueries({ exact: true, queryKey });
    scheduled = [];
    notifyManager.setScheduler((scheduledTask) => {
      scheduled.push(scheduledTask);
    });
  });

  afterEach(() => {
    client.clear();
    notifyManager.setScheduler((scheduledTask) => {
      setTimeout(scheduledTask, 0);
    });
    setQueryPersistenceUser(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("cancels slow restores during navigation and refreshes when the mailbox is reopened", async () => {
    const firstRead = Promise.withResolvers<null>();
    const secondRead = Promise.withResolvers<null>();
    const finishFirstRead = Promise.withResolvers<null>();
    const finishSecondRead = Promise.withResolvers<null>();
    const getItem = mailCache.getItem.bind(mailCache);
    const storageKey = `quieter-cache-${JSON.stringify(queryKey)}`;
    let reads = 0;
    vi.spyOn(mailCache, "getItem").mockImplementation(async (key) => {
      if (key === storageKey) {
        reads += 1;
        if (reads === 1) {
          firstRead.resolve(null);
          await finishFirstRead.promise;
        } else if (reads === 2) {
          secondRead.resolve(null);
          await finishSecondRead.promise;
        }
      }
      return await getItem(key);
    });
    const options = {
      getNextPageParam: () => {},
      initialPageParam: null,
      queryFn: async () =>
        await Promise.resolve({ messages: [{ id: "fresh" }] }),
      queryKey,
      retry: false,
    };
    const nextMailbox = {
      ...options,
      enabled: false,
      queryKey: ["messages", "mailbox", "sent", ""],
    };
    const observer = new InfiniteQueryObserver<
      MessagePage,
      Error,
      InfiniteData<MessagePage>,
      string[]
    >(client, options);
    const unsubscribe = observer.subscribe(() => {});
    try {
      await firstRead.promise;
      observer.setOptions(nextMailbox);
      finishFirstRead.resolve(null);
      await vi.waitFor(() => {
        expect(scheduled.length).toBeGreaterThan(0);
      });
      for (const scheduledTask of scheduled.splice(0)) {
        scheduledTask();
      }
      observer.setOptions(options);
      await secondRead.promise;
      observer.setOptions(nextMailbox);
      finishSecondRead.resolve(null);
      await settleScheduledTasks();
      observer.setOptions(options);
      await vi.waitFor(() => {
        for (const scheduledTask of scheduled.splice(0)) {
          scheduledTask();
        }
        expect(
          observer.getCurrentResult().data?.pages[0]?.messages
        ).toContainEqual(expect.objectContaining({ id: "fresh" }));
      });
      expect(observer.getCurrentResult().isError).toBeFalsy();
    } finally {
      finishFirstRead.resolve(null);
      finishSecondRead.resolve(null);
      unsubscribe();
    }
  });

  test("keeps a failed refresh observable while retaining restored data", async () => {
    const failure = new Error("The server could not load the mailbox.");
    const observer = new InfiniteQueryObserver<
      MessagePage,
      Error,
      InfiniteData<MessagePage>,
      string[]
    >(client, {
      getNextPageParam: () => {},
      initialPageParam: null,
      queryFn: async () => await Promise.reject(failure),
      queryKey,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await vi.waitFor(() => {
        for (const scheduledTask of scheduled.splice(0)) {
          scheduledTask();
        }
        expect(observer.getCurrentResult().error).toBe(failure);
      });
      expect(observer.getCurrentResult().data?.pages[0]).toMatchObject({
        messages: [{ id: "cached" }],
      });
    } finally {
      unsubscribe();
    }
  });

  test("does not refresh a restored mailbox after the persistence owner changes", async () => {
    const fetchMessages = vi
      .fn<() => Promise<MessagePage>>()
      .mockResolvedValue({
        messages: [{ id: "fresh" }],
      });
    const observer = new InfiniteQueryObserver<
      MessagePage,
      Error,
      InfiniteData<MessagePage>,
      string[]
    >(client, {
      getNextPageParam: () => {},
      initialPageParam: null,
      queryFn: fetchMessages,
      queryKey,
      retry: false,
    });
    const replacement = new QueryClient();
    const unsubscribe = observer.subscribe(() => {});
    try {
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data?.pages[0]).toMatchObject({
          messages: [{ id: "cached" }],
        });
      });
      setQueryPersistenceUser(crypto.randomUUID(), replacement);
      for (const scheduledTask of scheduled.splice(0)) {
        scheduledTask();
      }
      await settleScheduledTasks();
      expect(fetchMessages).not.toHaveBeenCalled();
      expect(replacement.getQueryData(queryKey)).toBeUndefined();
    } finally {
      unsubscribe();
      replacement.clear();
    }
  });
});
