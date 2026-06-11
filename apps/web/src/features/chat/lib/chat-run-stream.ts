import type { ChatRunStreamEvent } from "@quieter/orpc/chat-run-stream";

const chatRunStatuses = new Set([
  "queued",
  "running",
  "waiting_on_tool",
  "complete",
  "failed",
  "cancelled",
]);

const isChatMessageParts = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (part) =>
      part !== null && typeof part === "object" && "type" in part && typeof part.type === "string",
  );

const hasValidError = (event: Record<string, unknown>) =>
  !("error" in event) || event.error === null || typeof event.error === "string";

const isChatRunStreamEvent = (value: unknown): value is ChatRunStreamEvent => {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const event = value as Record<string, unknown>;

  if (event.type === "draft") {
    return typeof event.assistantMessageId === "string" && isChatMessageParts(event.parts);
  }

  if (event.type === "status") {
    return (
      typeof event.status === "string" && chatRunStatuses.has(event.status) && hasValidError(event)
    );
  }

  return (
    event.type === "done" &&
    typeof event.assistantMessageId === "string" &&
    isChatMessageParts(event.parts) &&
    typeof event.status === "string" &&
    chatRunStatuses.has(event.status) &&
    hasValidError(event)
  );
};

const parseSseEvent = (chunk: string): ChatRunStreamEvent | null => {
  const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));

  if (!dataLine) {
    return null;
  }

  try {
    const event: unknown = JSON.parse(dataLine.slice("data: ".length));

    return isChatRunStreamEvent(event) ? event : null;
  } catch {
    return null;
  }
};

export const consumeChatRunStream = async ({
  onEvent,
  runId,
  signal,
}: {
  onEvent: (event: ChatRunStreamEvent) => void;
  runId: string;
  signal?: AbortSignal;
}) => {
  const response = await fetch(`/api/chat/runs/${runId}/stream`, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new ChatRunStreamError(
      "Could not open the chat stream.",
      response.status !== 401 && response.status !== 403,
    );
  }

  if (!response.body) {
    throw new ChatRunStreamError("The chat stream did not return a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const emitEvent = (event: ChatRunStreamEvent | null) => {
    if (!event) {
      return;
    }

    onEvent(event);
    completed ||= event.type === "done";
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      emitEvent(parseSseEvent(chunk));
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    emitEvent(parseSseEvent(buffer));
  }

  if (!completed && !signal?.aborted) {
    throw new ChatRunStreamError("Chat stream disconnected.");
  }
};

export class ChatRunStreamError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "ChatRunStreamError";
  }
}
