import { describe, expect, test } from "bun:test";
import {
  chatQueryOptions,
  chatsQueryOptions,
  getChatQueryKey,
  getChatsQueryKey,
} from "./chat-query";

describe("mailbox-scoped chat queries", () => {
  test("does not list chats without a mailbox", () => {
    const options = chatsQueryOptions(null);

    expect(options.enabled).toBe(false);
    expect(options.queryKey[1]).toBeNull();
  });

  test("isolates chat lists and transcripts by mailbox", () => {
    expect(getChatsQueryKey("mailbox-one")).not.toEqual(getChatsQueryKey("mailbox-two"));
    expect(getChatQueryKey("mailbox-one", "chat-one")).not.toEqual(
      getChatQueryKey("mailbox-two", "chat-one"),
    );
  });

  test("does not load a transcript without a chat id", () => {
    expect(chatQueryOptions("mailbox-one", null).enabled).toBe(false);
  });
});
