import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { mailCache } from "./mail-cache";
import { bindMailCache } from "./mail-cache-lifecycle";

describe("mail cache error eviction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
        client.fetchQuery({
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
