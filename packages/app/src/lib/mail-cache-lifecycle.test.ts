import { createRecentConversations } from "@quieter/app/features/mailbox/domain/recent-conversations";
import { mailCache } from "@quieter/app/lib/mail-cache";
import {
  bindMailCache,
  subscribeMailboxAccessLoss,
} from "@quieter/app/lib/mail-cache-lifecycle";
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
