import type { ChatMessagePart } from "@quieter/database";

export type ChatRunStreamEvent =
  | {
      assistantMessageId: string;
      parts: ChatMessagePart[];
      type: "draft";
    }
  | {
      error?: string | null;
      status: string;
      type: "status";
    }
  | {
      assistantMessageId: string;
      error?: string | null;
      parts: ChatMessagePart[];
      status: string;
      type: "done";
    };

const parseSseEvent = (chunk: string): ChatRunStreamEvent | null => {
  const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));

  if (!dataLine) {
    return null;
  }

  try {
    return JSON.parse(dataLine.slice("data: ".length)) as ChatRunStreamEvent;
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
    throw new Error("Could not open the chat stream.");
  }

  if (!response.body) {
    throw new Error("The chat stream did not return a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const event = parseSseEvent(chunk);

      if (event) {
        onEvent(event);
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);

    if (event) {
      onEvent(event);
    }
  }
};
