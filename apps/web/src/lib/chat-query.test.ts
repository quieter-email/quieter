import { describe, expect, test } from "vite-plus/test";

import {
  chatQueryOptions,
  chatsQueryOptions,
  getChatQueryKey,
  getChatsQueryKey,
} from "./chat-query";

describe("mailbox-scoped chat queries", () => {
  test("does not list chats without a mailbox", () => {
    const options = chatsQueryOptions(null);

    expect(options.enabled).toBeFalsy();
    expect(options.queryKey[0]).toBe("chats");
    expect(options.queryKey[1]).toBe("disabled");
  });

  test("isolates chat lists and transcripts by mailbox", () => {
    expect(getChatsQueryKey("mailbox-one")).not.toStrictEqual(
      getChatsQueryKey("mailbox-two")
    );
    expect(getChatQueryKey("mailbox-one", "chat-one")).not.toStrictEqual(
      getChatQueryKey("mailbox-two", "chat-one")
    );
  });

  test("does not load a transcript without a chat id", () => {
    expect(chatQueryOptions("mailbox-one", null).enabled).toBeFalsy();
  });
});
