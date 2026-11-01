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
    vi.spyOn(mailCache, "removeMailbox").mockImplementation(async () => {
      expect(history.state.get().entries).toHaveLength(0);
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
    history.recordOpened(visit);
    expect(history.state.get().entries).toHaveLength(0);
    expect(otherListener).not.toHaveBeenCalled();
    unsubscribe();
    unsubscribeOther();
    dispose();
    client.clear();
    otherClient.clear();
  });

  test.each([
    { data: undefined, purge: false, status: 404 },
    { data: { resource: "mailbox" }, purge: true, status: 404 },
    { data: undefined, purge: true, status: 403 },
  ])(
    "scopes cache eviction for $status and $data",
    async ({ status, data, purge }) => {
      const client = new QueryClient();
      const removeMailbox = vi
        .spyOn(mailCache, "removeMailbox")
        .mockResolvedValue();
      const removeItem = vi.spyOn(mailCache, "removeItem").mockResolvedValue();
      const dispose = bindMailCache(client);
      const queryKey = ["message-thread", "thread", "mailbox"];
      client.setQueryData(queryKey, { messages: [{ id: "message" }] });
      await expect(
        client.query({
          queryFn: async () => {
            await Promise.reject(
              Object.assign(new Error("missing"), { data, status })
            );
          },
          queryKey,
          retry: false,
        })
      ).rejects.toThrow("missing");
      expect(removeMailbox.mock.calls).toStrictEqual(
        purge ? [["mailbox"]] : []
      );
      expect(removeItem.mock.calls).toStrictEqual(
        purge
          ? []
          : [
              [`quieter-cache-${JSON.stringify(queryKey)}`],
              ['body-["mailbox","message"]'],
            ]
      );
      dispose();
      client.clear();
    }
  );
});
