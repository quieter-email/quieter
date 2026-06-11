import type { ChatRunStreamEvent } from "@quieter/orpc/chat-run-stream";

const parseSseEvent = (chunk: string): ChatRunStreamEvent | null => {
  const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));

  if (!dataLine) {
    return null;
  }

  try {
    const event: unknown = JSON.parse(dataLine.slice("data: ".length));

    if (
      !event ||
      typeof event !== "object" ||
      !("type" in event) ||
      !["done", "draft", "status"].includes(String(event.type))
    ) {
      return null;
    }

    return event as ChatRunStreamEvent;
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
