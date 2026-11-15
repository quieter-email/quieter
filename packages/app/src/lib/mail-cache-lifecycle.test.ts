import { createRecentConversations } from "@quieter/app/features/mailbox/domain/recent-conversations";
import { mailCache } from "@quieter/app/lib/mail-cache";
import {
  attachThreadPreloader,
  bindMailCache,
  subscribeMailboxAccessLoss,
} from "@quieter/app/lib/mail-cache-lifecycle";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import type * as OrpcModule from "@quieter/app/lib/orpc";
import { rpc } from "@quieter/app/lib/orpc";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

describe("mail cache error eviction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("scrubs private visits synchronously before asynchronous mailbox eviction", async () => {
    const client = new QueryClient();
    const otherClient = new QueryClient();
    const history = createRecentConversations();
    history.authorize(new Set(["mailbox"]));
    const visit = {
      mailboxId: "mailbox",
      message: { id: "opened", threadId: "thread" },
    };
    history.recordOpened(visit);
    const otherListener = vi.fn<() => void>();
    const unsubscribe = subscribeMailboxAccessLoss(client, (loss) => {
      history.loseAccess(loss);
    });
    const unsubscribeOther = subscribeMailboxAccessLoss(
      otherClient,
      otherListener
    );
    let entriesAtEviction: number | undefined;
    const removeMailbox = vi
      .spyOn(mailCache, "removeMailbox")
      .mockImplementation(async () => {
        entriesAtEviction = history.state.get().entries.length;
        await Promise.resolve();
      });
    const dispose = bindMailCache(client);
    await expect(
      client.query({
        queryFn: async () => {
          await Promise.reject(
            Object.assign(new Error("revoked"), { status: 403 })
          );
        },
        queryKey: ["verification-codes", "mailbox", "threads", ["thread"]],
        retry: false,
      })
    ).rejects.toThrow("revoked");
    expect(removeMailbox).toHaveBeenCalledWith("mailbox");
    expect(entriesAtEviction).toBe(0);
    history.recordOpened(visit);
    expect(history.state.get().entries).toHaveLength(0);
    expect(otherListener).not.toHaveBeenCalled();
    unsubscribe();
    unsubscribeOther();
    dispose();
    client.clear();
    otherClient.clear();
  });
});

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const actual = await importOriginal<typeof OrpcModule>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      mail: {
        ...actual.rpc.mail,
        getThread: vi.fn<typeof actual.rpc.mail.getThread>(),
      },
    },
  };
});

describe("bounded thread preload", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("does not restart delayed intent after mailbox access is revoked", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "visible" })
    );
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { onLine: true });
    const requests: string[] = [];
    vi.mocked(rpc.mail.getThread).mockImplementation(
      async ({ mailboxId, threadId }) => {
        requests.push(mailboxId);
        return await Promise.resolve({
          messages: [{ bodyText: "fixture", id: threadId, threadId }],
          threadId,
        });
      }
    );
    vi.spyOn(mailCache, "removeMailbox").mockResolvedValue();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const dispose = bindMailCache(client);
    const preloader = attachThreadPreloader(client);
    preloader.intent({
      expectedMessage: { id: "message", includeDrafts: false },
      mailboxId: "revoked",
      threadId: "thread",
    });
    await expect(
      client.query({
        queryFn: async () =>
          await Promise.reject(
            Object.assign(new Error("revoked"), { status: 403 })
          ),
        queryKey: ["verification-codes", "revoked", "threads", ["thread"]],
      })
    ).rejects.toThrow("revoked");
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).not.toContain("revoked");
    preloader.update([
      {
        expectedMessage: { id: "other-message", includeDrafts: false },
        mailboxId: "allowed",
        threadId: "other-thread",
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toContain("allowed");
    preloader.dispose();
    dispose();
    client.clear();
  });

  test("warms the viewed sixth row and shares its delayed request with opening", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "visible" })
    );
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", { onLine: true });
    let running = 0;
    let maximum = 0;
    const requests: string[] = [];
    vi.mocked(rpc.mail.getThread).mockImplementation(async ({ threadId }) => {
      requests.push(threadId);
      running += 1;
      maximum = Math.max(maximum, running);
      // oxlint-disable-next-line promise/avoid-new -- Delay the local RPC fixture under the fake clock.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 300);
      });
      running -= 1;
      return {
        messages: [
          {
            bodyText: "complete local fixture",
            id: threadId,
            snippet: "body",
            threadId,
          },
        ],
        threadId,
      };
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const preloader = attachThreadPreloader(client);
    const dispose = bindMailCache(client);
    const rows = Array.from({ length: 8 }, (_, index) => ({
      expectedMessage: { id: `row-${index + 1}`, includeDrafts: false },
      mailboxId: "source-mailbox",
      threadId: `row-${index + 1}`,
    }));
    preloader?.update(rows);
    await vi.advanceTimersByTimeAsync(350);
    preloader?.intent(rows[7] ?? null);
    await vi.advanceTimersByTimeAsync(200);
    const opening = client.query(
      getThreadWithDetailsOptions(
        "source-mailbox",
        "row-8",
        true,
        rows[7]?.expectedMessage
      )
    );
    await vi.advanceTimersByTimeAsync(300);
    const opened = await opening;
    expect(opened.messages[0]?.bodyText).toBeTruthy();
    expect(requests.filter((id) => id === "row-8")).toHaveLength(1);
    expect(maximum).toBeLessThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(3000);
    const warmedSixth = client.getQueryData(
      getThreadWithDetailsOptions("source-mailbox", "row-6").queryKey
    );
    expect(warmedSixth?.messages[0]?.bodyText).toBeTruthy();
    const beforeClick = requests.length;
    await client.query(
      getThreadWithDetailsOptions(
        "source-mailbox",
        "row-6",
        true,
        rows[5]?.expectedMessage
      )
    );
    expect(requests).toHaveLength(beforeClick);
    preloader?.dispose();
    dispose();
    client.clear();
  });

  test("drops old mailbox backlog and pauses hidden, offline and constrained speculation", async () => {
    vi.useFakeTimers();
    const documentState = Object.assign(new EventTarget(), {
      visibilityState: "hidden",
    });
    const windowState = new EventTarget();
    const connection = Object.assign(new EventTarget(), { saveData: false });
    const navigatorState = { connection, onLine: true };
    vi.stubGlobal("document", documentState);
    vi.stubGlobal("window", windowState);
    vi.stubGlobal("navigator", navigatorState);
    const requests: string[] = [];
    vi.mocked(rpc.mail.getThread).mockImplementation(async ({ threadId }) => {
      requests.push(threadId);
      // oxlint-disable-next-line promise/avoid-new -- Hold the local RPC fixture during navigation.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5000);
      });
      return {
        messages: [{ bodyText: "fixture", id: threadId, threadId }],
        threadId,
      };
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const dispose = bindMailCache(client);
    const first = attachThreadPreloader(client);
    first?.update(
      Array.from({ length: 40 }, (_, index) => ({
        expectedMessage: { id: `old-${index}`, includeDrafts: false },
        mailboxId: "old",
        threadId: `old-${index}`,
      }))
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(0);
    documentState.visibilityState = "visible";
    documentState.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toContain("old-0");
    const second = attachThreadPreloader(client);
    second?.update([
      {
        expectedMessage: { id: "current", includeDrafts: false },
        mailboxId: "new",
        threadId: "current",
      },
    ]);
    first?.dispose();
    navigatorState.onLine = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests).not.toContain("current");
    navigatorState.onLine = true;
    connection.saveData = true;
    windowState.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).not.toContain("current");
    connection.saveData = false;
    connection.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toContain("current");
    expect(requests.filter((id) => id.startsWith("old-"))).toHaveLength(2);
    second?.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    dispose();
    client.clear();
  });
});
