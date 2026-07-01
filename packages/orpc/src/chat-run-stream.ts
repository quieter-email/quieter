import type { ChatMessagePart, ChatRunStatus } from "@quieter/database/schema";

export const ACTIVE_CHAT_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_on_tool",
] as const satisfies ChatRunStatus[];

export const isActiveChatRunStatus = (
  status: ChatRunStatus,
): status is (typeof ACTIVE_CHAT_RUN_STATUSES)[number] =>
  ACTIVE_CHAT_RUN_STATUSES.includes(status as (typeof ACTIVE_CHAT_RUN_STATUSES)[number]);

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

const getRunEntryIfExists = (runId: string) => runEntries.get(runId);

export const publishChatRunEvent = (runId: string, event: ChatRunStreamEvent) => {
  const entry = getRunEntryIfExists(runId);

  if (!entry || entry.subscribers.size === 0) {
    if (entry) {
      runEntries.delete(runId);
    }

    return;
  }

  for (const subscriber of entry.subscribers) {
    try {
      subscriber(event);
    } catch (error) {
      console.error("Could not publish a chat run stream event.", error);
    }
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

export const formatChatRunSse = (event: ChatRunStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;
