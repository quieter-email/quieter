import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vite-plus/test";

import type { MessageDeliveryStatus } from "./delivery-status";
import { getMessageListDeliveryOptions } from "./message-delivery-query";

const { listStatuses } = vi.hoisted(() => ({
  listStatuses: vi
    .fn<
      (input: {
        mailboxId: string;
        messageIds: string[];
      }) => Promise<Record<string, MessageDeliveryStatus[]>>
    >()
    .mockResolvedValue({}),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the queried transport method is needed; importing the real browser client requires a request context.
vi.mock("#/lib/orpc", () => ({
  rpc: { mail: { listMessageDeliveryStatuses: listStatuses } },
}));

describe(getMessageListDeliveryOptions, () => {
  test("batches more than 100 loaded messages and polls missing first feedback", async () => {
    listStatuses.mockClear();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const messageIds = Array.from({ length: 205 }, (_, index) => String(index));
    const options = getMessageListDeliveryOptions({
      enabled: true,
      mailboxId: "mailbox-a",
      messageIds,
    });
    await client.fetchQuery(options);
    expect(
      listStatuses.mock.calls.map(([input]) => input.messageIds.length)
    ).toStrictEqual([100, 100, 5]);
    expect(
      listStatuses.mock.calls.every(
        ([input]) => input.mailboxId === "mailbox-a"
      )
    ).toBeTruthy();
    const query = client
      .getQueryCache()
      .build<
        Record<string, MessageDeliveryStatus[]>,
        Error,
        Record<string, MessageDeliveryStatus[]>,
        (string | string[])[]
      >(client, options);
    if (typeof options.refetchInterval !== "function") {
      throw new TypeError("Expected delivery polling function");
    }
    expect(options.refetchInterval(query)).toBe(15_000);
    client.clear();
  });
});
