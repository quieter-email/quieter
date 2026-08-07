import type { ChatMessagePart, ChatRunStatus } from "@quieter/database/schema";
import { StreamProcessor, type UIMessage } from "@tanstack/ai";
import { fetchServerSentEvents } from "@tanstack/ai-react";

export type ChatRunStreamDone = {
  assistantMessageId: string;
  error?: string | null;
  parts: ChatMessagePart[];
  status: ChatRunStatus;
};

const getAssistantParts = (messages: UIMessage[]): ChatMessagePart[] => {
  const parts = messages.flatMap((message) =>
    message.role === "assistant" ? (message.parts as ChatMessagePart[]) : [],
  );
  return parts.length > 0 ? parts : [{ content: "", type: "text" }];
};

const statusFromStreamError = (
  error: Error | null,
): {
  error?: string | null;
  status: ChatRunStatus;
} => {
  if (!error) {
    return { status: "complete" };
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code === "cancelled" || /cancel/i.test(error.message)) {
    return { error: null, status: "cancelled" };
  }

  return {
    error: error.message || "The response could not finish.",
    status: "failed",
  };
};

export const consumeChatRunStream = async ({
  assistantMessageId,
  onDraft,
  runId,
  signal,
}: {
  assistantMessageId: string;
  onDraft: (input: { assistantMessageId: string; parts: ChatMessagePart[] }) => void;
  runId: string;
  signal?: AbortSignal;
}): Promise<ChatRunStreamDone> => {
  const connection = fetchServerSentEvents(`/api/chat/runs/${encodeURIComponent(runId)}/stream`, {
    credentials: "include",
    reconnect: { delayMs: 250, maxAttempts: 8 },
  });

  let streamError: Error | null = null;

  const processor = new StreamProcessor({
    initialMessages: [],
    events: {
      onError: (error) => {
        streamError = error;
      },
      onMessagesChange: (messages) => {
        onDraft({
          assistantMessageId,
          parts: getAssistantParts(messages),
        });
      },
    },
  });

  try {
    await processor.process(connection.joinRun(runId, signal));
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    throw new ChatRunStreamError(
      error instanceof Error && error.message ? error.message : "Could not open the chat stream.",
      !(error instanceof Error && /401|403|Unauthorized/i.test(error.message)),
    );
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return {
    assistantMessageId,
    parts: getAssistantParts(processor.getMessages()),
    ...statusFromStreamError(streamError),
  };
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
