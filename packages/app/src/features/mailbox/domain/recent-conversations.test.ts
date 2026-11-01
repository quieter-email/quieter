import { createRecentConversations } from "@quieter/app/features/mailbox/domain/recent-conversations";
import { describe, expect, test } from "vite-plus/test";

describe("session recent conversations", () => {
  test("keeps mailbox identity and promotes the genuine reopened message in a conversation", () => {
    const history = createRecentConversations();
    history.authorize(new Set(["a", "b"]));
    history.recordOpened({
      mailboxId: "a",
      message: { id: "first", threadId: "same" },
    });
    history.recordOpened({
      mailboxId: "b",
      message: { id: "second", threadId: "same" },
    });
    history.recordOpened({
      mailboxId: "a",
      message: {
        bodyText: "Private full content",
        id: "reopened",
        threadId: "same",
      },
    });
    expect(history.state.get().entries).toMatchObject([
      { mailboxId: "a", message: { id: "reopened" } },
      { mailboxId: "b", message: { id: "second" } },
    ]);
    expect(history.state.get().entries[0]?.message).not.toHaveProperty(
      "bodyText"
    );
  });

  test("fails closed without authorization while cache removal preserves recoverable visits", () => {
    const history = createRecentConversations();
    const visit = {
      mailboxId: "a",
      message: { id: "opened", threadId: "thread" },
    };
    history.recordOpened(visit);
    expect(history.state.get().entries).toHaveLength(0);
    history.authorize(new Set(["a"]));
    history.recordOpened(visit);
    history.authorize();
    history.recordOpened({
      mailboxId: "a",
      message: { id: "late", threadId: "other" },
    });
    history.authorize(new Set(["a"]));
    expect(history.state.get().entries).toMatchObject([
      { message: { id: "opened" } },
    ]);
    history.authorize(new Set());
    expect(history.state.get().entries).toHaveLength(0);
  });

  test("quarantines revoked access despite stale lists, isolates thread loss and permanently fences logout", () => {
    const history = createRecentConversations();
    history.authorize(new Set(["a", "b"]));
    const a = { mailboxId: "a", message: { id: "a", threadId: "same" } };
    const b = { mailboxId: "b", message: { id: "b", threadId: "same" } };
    history.recordOpened(a);
    history.recordOpened(b);
    history.loseAccess({ mailboxId: "a" });
    history.authorize(new Set(["a", "b"]));
    history.recordOpened(a);
    expect(history.state.get().entries).toMatchObject([{ mailboxId: "b" }]);
    history.loseAccess({ mailboxId: "b", threadId: "same" });
    expect(history.state.get().entries).toHaveLength(0);
    history.recordOpened(b);
    history.revoke();
    history.authorize(new Set(["a", "b"]));
    history.recordOpened(b);
    expect(history.state.get().entries).toHaveLength(0);
    const nextSession = createRecentConversations();
    nextSession.authorize(new Set(["b"]));
    nextSession.recordOpened(b);
    expect(nextSession.state.get().entries).toMatchObject([{ mailboxId: "b" }]);
  });
});
