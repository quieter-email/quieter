import { applyMailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxRouteState } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { describe, expect, test } from "vite-plus/test";

const mailState: MailboxRouteState = {
  chatId: "chat-1",
  compose: undefined,
  mailbox: "inbox",
  mailboxId: "mailbox-1",
  mailto: undefined,
  messageId: "message-1",
  query: "invoices",
  threadId: "thread-1",
  view: "inbox",
};

describe("mailbox route search", () => {
  test("preserves the active chat while navigating mail", () => {
    expect(
      applyMailboxSearchPatch(mailState, {
        mailbox: "sent",
        messageId: null,
        view: "inbox",
      })
    ).toStrictEqual({
      ...mailState,
      mailbox: "sent",
      messageId: undefined,
      threadId: undefined,
    });
  });

  test("updates only the chat when selecting a conversation", () => {
    expect(
      applyMailboxSearchPatch(mailState, { chatId: "chat-2" })
    ).toStrictEqual({ ...mailState, chatId: "chat-2" });
  });

  test("clears the chat without changing the underlying mail route", () => {
    expect(applyMailboxSearchPatch(mailState, { chatId: null })).toStrictEqual({
      ...mailState,
      chatId: undefined,
    });
  });
});
