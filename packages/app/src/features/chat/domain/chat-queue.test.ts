import { createStore } from "@tanstack/react-store";
import { describe, expect, test } from "vite-plus/test";

import { updateChatQueue } from "./chat-queue";
import type { ChatQueues, QueuedChatMessage } from "./chat-queue";

const first: QueuedChatMessage = {
  category: "inbox",
  context: { messageIds: ["attached-message"] },
  id: "first",
  text: "Read the attached message",
};
const second: QueuedChatMessage = {
  category: "sent",
  context: { query: "subject:follow-up" },
  id: "second",
  text: "Find the follow-up",
};

describe("chat message queue", () => {
  test("releases only the head after a successful turn", () => {
    const store = createStore<ChatQueues>(new Map());
    const key = "mailbox:chat";
    updateChatQueue(store, key, { type: "start" });
    updateChatQueue(store, key, { message: first, type: "add" });
    updateChatQueue(store, key, { message: second, type: "add" });
    updateChatQueue(store, key, { id: first.id, type: "take" });
    expect(store.get().get(key)?.items).toMatchObject([first, second]);

    updateChatQueue(store, key, { type: "finish" });
    updateChatQueue(store, key, { id: second.id, type: "take" });
    updateChatQueue(store, key, { id: first.id, type: "take" });
    updateChatQueue(store, key, { id: second.id, type: "take" });
    expect(store.get().get(key)?.items).toMatchObject([second]);
  });

  test("retains unsent messages after Stop until the user resumes", () => {
    const store = createStore<ChatQueues>(new Map());
    const key = "mailbox:chat";
    updateChatQueue(store, key, { type: "start" });
    updateChatQueue(store, key, { message: first, type: "add" });
    updateChatQueue(store, key, { message: second, type: "add" });
    updateChatQueue(store, key, { type: "cancel" });
    updateChatQueue(store, key, { type: "finish" });
    updateChatQueue(store, key, { type: "resume" });
    updateChatQueue(store, key, { id: first.id, type: "take" });
    expect(store.get().get(key)?.items).toMatchObject([first, second]);

    updateChatQueue(store, key, { type: "canceled" });
    updateChatQueue(store, key, { id: first.id, type: "take" });
    expect(store.get().get(key)?.items).toMatchObject([first, second]);

    updateChatQueue(store, key, { id: first.id, type: "remove" });
    updateChatQueue(store, key, { type: "resume" });
    updateChatQueue(store, key, { id: second.id, type: "take" });
    expect(store.get().get(key)?.items).toHaveLength(0);
  });

  test("keeps each conversation's queue separate and pauses drafts after a rejected edit", () => {
    const store = createStore<ChatQueues>(new Map());
    const original = "mailbox:original";
    const edit = "mailbox:edited";
    updateChatQueue(store, original, { message: first, type: "add" });
    updateChatQueue(store, edit, { type: "start" });
    updateChatQueue(store, edit, { message: second, type: "add" });
    updateChatQueue(store, edit, { type: "finish" });
    expect(store.get().get(original)?.items).toMatchObject([first]);
    expect(store.get().get(edit)?.items).toMatchObject([second]);

    updateChatQueue(store, original, { sourceKey: edit, type: "return-edit" });
    updateChatQueue(store, original, { id: first.id, type: "take" });
    expect(store.get().get(original)?.items).toMatchObject([first, second]);
    expect(store.get().get(edit)).toBeUndefined();
  });
});
