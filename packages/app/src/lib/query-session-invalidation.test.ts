import "fake-indexeddb/auto";
import { createRecentConversations } from "@quieter/app/features/mailbox/domain/recent-conversations";
import { mailCache } from "@quieter/app/lib/mail-cache";
import {
  captureQueryPersistenceCleanup,
  setQueryPersistenceUser,
  subscribeQuerySessionInvalidation,
} from "@quieter/app/lib/query-persister";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

describe("query session invalidation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("fences the captured owner before clearing and leaves a newer client intact", async () => {
    vi.stubGlobal("window", { localStorage: { length: 0 } });
    const oldClient = new QueryClient();
    const newClient = new QueryClient();
    const oldHistory = createRecentConversations();
    oldHistory.authorize(new Set(["mailbox"]));
    const visit = {
      mailboxId: "mailbox",
      message: { id: "opened", threadId: "thread" },
    };
    oldHistory.recordOpened(visit);
    oldClient.setQueryData(["private"], "old data");
    newClient.setQueryData(["private"], "new data");
    setQueryPersistenceUser("user", oldClient, "old-session");
    await mailCache.setUser("user", "old-session");
    const cleanup = captureQueryPersistenceCleanup();
    const newListener = vi.fn<() => void>();
    const unsubscribeNew = subscribeQuerySessionInvalidation(
      newClient,
      newListener
    );
    const unsubscribeOld = subscribeQuerySessionInvalidation(oldClient, () => {
      expect(oldClient.getQueryData(["private"])).toBeDefined();
      oldHistory.revoke();
    });
    setQueryPersistenceUser("user", newClient, "new-session");
    await mailCache.setUser("user", "new-session");
    expect(cleanup).toBeDefined();
    await cleanup?.();
    oldHistory.recordOpened(visit);
    expect(oldHistory.state.get().entries).toHaveLength(0);
    expect(oldClient.getQueryData(["private"])).toBeUndefined();
    expect(newClient.getQueryData(["private"])).toBeDefined();
    expect(newListener).not.toHaveBeenCalled();
    unsubscribeOld();
    unsubscribeNew();
    oldClient.clear();
    newClient.clear();
  });

  test("uses the matching existing logout channel to revoke before a remote clear", async () => {
    const channel = Object.assign(new EventTarget(), {
      postMessage: vi.fn<(message: unknown) => void>(),
    });
    vi.stubGlobal("window", {
      // oxlint-disable-next-line prefer-arrow-callback -- BroadcastChannel is invoked as a constructor.
      BroadcastChannel: vi.fn<() => typeof channel>(function createChannel() {
        return channel;
      }),
      localStorage: { length: 0 },
    });
    const client = new QueryClient();
    setQueryPersistenceUser("remote-user", client, "remote-session");
    await mailCache.setUser("remote-user", "remote-session");
    const history = createRecentConversations();
    history.authorize(new Set(["mailbox"]));
    const visit = {
      mailboxId: "mailbox",
      message: { id: "opened", threadId: "thread" },
    };
    history.recordOpened(visit);
    client.setQueryData(["private"], "private data");
    const unsubscribe = subscribeQuerySessionInvalidation(client, () => {
      expect(client.getQueryData(["private"])).toBeDefined();
      history.revoke();
    });
    channel.dispatchEvent(
      new MessageEvent("message", { data: "other-session" })
    );
    expect(history.state.get().entries).not.toHaveLength(0);
    channel.dispatchEvent(
      new MessageEvent("message", { data: "remote-session" })
    );
    history.recordOpened(visit);
    expect(history.state.get().entries).toHaveLength(0);
    expect(client.getQueryData(["private"])).toBeUndefined();
    unsubscribe();
    client.clear();
  });
});
