import type { ChatMessagePart, ChatRunStatus } from "@quieter/database";

export type ChatRunStreamEvent =
  | {
      assistantMessageId: string;
      parts: ChatMessagePart[];
      type: "draft";
    }
  | {
      error?: string | null;
      status: ChatRunStatus;
      type: "status";
    }
  | {
      assistantMessageId: string;
      error?: string | null;
      parts: ChatMessagePart[];
      status: ChatRunStatus;
      type: "done";
    };

type RunSubscriber = (event: ChatRunStreamEvent) => void;

type RunEntry = {
  subscribers: Set<RunSubscriber>;
};

const runEntries = new Map<string, RunEntry>();

const getRunEntry = (runId: string) => {
  let entry = runEntries.get(runId);

  if (!entry) {
    entry = { subscribers: new Set() };
    runEntries.set(runId, entry);
  }

  return entry;
};

export const publishChatRunEvent = (runId: string, event: ChatRunStreamEvent) => {
  for (const subscriber of getRunEntry(runId).subscribers) {
    subscriber(event);
  }
};

export const subscribeChatRunEvents = (runId: string, subscriber: RunSubscriber) => {
  getRunEntry(runId).subscribers.add(subscriber);

  return () => {
    const entry = runEntries.get(runId);

    if (!entry) {
      return;
    }

    entry.subscribers.delete(subscriber);

    if (entry.subscribers.size === 0) {
      runEntries.delete(runId);
    }
  };
};

export const waitForChatRunStream = (runId: string, onEvent: RunSubscriber, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const unsubscribe = subscribeChatRunEvents(runId, (event) => {
      onEvent(event);

      if (event.type === "done") {
        cleanup();
        resolve();
      }
    });

    const cleanup = () => {
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const formatChatRunSse = (event: ChatRunStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;
