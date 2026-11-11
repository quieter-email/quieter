import type { ChatMailContext } from "@quieter/ai/chat-context";
import type { ChatModel } from "@quieter/ai/chat-models";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import type { Store } from "@tanstack/react-store";

export type QueuedChatMessage = {
  category: MailboxCategory;
  context: ChatMailContext;
  id: string;
  model?: ChatModel;
  text: string;
};

type ChatQueue = {
  items: readonly QueuedChatMessage[];
  phase: "ready" | "waiting" | "paused" | "canceling";
};

type QueueAction =
  | { type: "add" | "restore"; message: QueuedChatMessage }
  | { type: "remove" | "take"; id: string }
  | { type: "start" | "finish" | "pause" | "resume" | "cancel" | "canceled" }
  | { type: "return-edit"; sourceKey: string };

export type ChatQueues = Map<string, ChatQueue>;
export type ChatQueueStore = Store<ChatQueues>;
export const emptyChatQueue: ChatQueue = { items: [], phase: "ready" };

export const updateChatQueue = (
  store: ChatQueueStore,
  key: string,
  action: QueueAction
) => {
  store.setState((current) => {
    const queue = current.get(key) ?? emptyChatQueue;
    let next: ChatQueue;
    switch (action.type) {
      case "add": {
        next = { ...queue, items: [...queue.items, action.message] };
        break;
      }
      case "remove": {
        next = {
          ...queue,
          items: queue.items.filter(({ id }) => id !== action.id),
        };
        break;
      }
      case "take": {
        if (queue.phase !== "ready" || queue.items[0]?.id !== action.id) {
          return current;
        }
        next = { items: queue.items.slice(1), phase: "waiting" };
        break;
      }
      case "start": {
        if (queue.phase === "paused" && queue.items.length > 0) {
          return current;
        }
        next = { ...queue, phase: "waiting" };
        break;
      }
      case "finish": {
        if (queue.phase !== "waiting") {
          return current;
        }
        next = { ...queue, phase: "ready" };
        break;
      }
      case "pause": {
        if (queue.phase === "canceling") {
          return current;
        }
        next = { ...queue, phase: "paused" };
        break;
      }
      case "resume": {
        if (queue.phase !== "paused") {
          return current;
        }
        next = { ...queue, phase: "ready" };
        break;
      }
      case "cancel": {
        next = { ...queue, phase: "canceling" };
        break;
      }
      case "canceled": {
        if (queue.phase !== "canceling") {
          return current;
        }
        next = { ...queue, phase: "paused" };
        break;
      }
      case "restore": {
        next = { items: [action.message, ...queue.items], phase: "paused" };
        break;
      }
      case "return-edit": {
        const edited = current.get(action.sourceKey);
        if (edited === undefined) {
          return current;
        }
        const result = new Map(current);
        result.delete(action.sourceKey);
        if (edited.items.length > 0) {
          result.set(key, {
            items: [...queue.items, ...edited.items],
            phase: "paused",
          });
        }
        return result;
      }
      default: {
        return current;
      }
    }
    const result = new Map(current);
    if (next.items.length === 0 && next.phase === "ready") {
      result.delete(key);
    } else {
      result.set(key, next);
    }
    return result;
  });
};
