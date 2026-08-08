import type { ChatMessagePart, ChatRunStatus } from "@quieter/database/schema";
import { EventType, StreamProcessor, type StreamChunk, type UIMessage } from "@tanstack/ai";

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

const isTerminalChunk = (chunk: StreamChunk) =>
  chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR;

const waitForRetry = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const finish = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(finish, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

type SseEvent = { chunk: StreamChunk; id?: string };

/** Minimal SSE reader for the observation endpoint (supports id: + data:). */
const readSseEvents = async function* (
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingId: string | undefined;

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
          continue;
        }
        if (line.startsWith(":") || line.startsWith("event:") || line.startsWith("retry:")) {
          continue;
        }
        if (line === "id" || line.startsWith("id:")) {
          const rawId = line === "id" ? "" : line.slice(3);
          pendingId = rawId.startsWith(" ") ? rawId.slice(1) : rawId;
          continue;
        }
        if (!line.startsWith("data:") && !line.startsWith("data: ")) {
          continue;
        }
        const data = line.startsWith("data: ") ? line.slice(6) : line.slice(5).trimStart();
        if (data === "[DONE]") {
          return;
        }
        const chunk = JSON.parse(data) as StreamChunk;
        const id = pendingId;
        pendingId = undefined;
        yield id === undefined || id === "" ? { chunk } : { chunk, id };
      }
    }
  } finally {
    reader.releaseLock();
  }
};

/**
 * Follow a run's live delivery stream (dump-then-live).
 * Reconnects after a drop until a terminal chunk arrives.
 * Hydrate the UI from the draft before calling; the SSE rebuilds from the hub buffer.
 */
const followChatRunEvents = async function* ({
  runId,
  signal,
}: {
  runId: string;
  signal?: AbortSignal;
}): AsyncGenerator<StreamChunk> {
  const seen = new Set<string>();
  let lastEventId: string | undefined;
  let reconnectAttempts = 0;

  for (;;) {
    if (signal?.aborted) {
      return;
    }

    const url = new URL(
      `/api/chat/runs/${encodeURIComponent(runId)}/stream`,
      window.location.origin,
    );
    url.searchParams.set("runId", runId);

    const headers = new Headers();
    if (lastEventId) {
      headers.set("Last-Event-ID", lastEventId);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        credentials: "include",
        headers,
        method: "GET",
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      if (++reconnectAttempts > 8) {
        throw error;
      }
      await waitForRetry(250, signal);
      continue;
    }

    if (!response.ok) {
      throw new ChatRunStreamError(
        response.status === 401 || response.status === 403
          ? "Unauthorized"
          : `Chat stream failed (${response.status}).`,
        response.status !== 401 && response.status !== 403,
      );
    }

    if (!response.body) {
      throw new ChatRunStreamError("Chat stream returned no body.", true);
    }

    let sawTerminal = false;
    let progressed = false;

    try {
      for await (const event of readSseEvents(response.body, signal)) {
        if (event.id !== undefined) {
          if (seen.has(event.id)) {
            continue;
          }
          seen.add(event.id);
          lastEventId = event.id;
        }
        progressed = true;
        reconnectAttempts = 0;
        if (isTerminalChunk(event.chunk)) {
          sawTerminal = true;
        }
        yield event.chunk;
      }
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      if (lastEventId !== undefined && ++reconnectAttempts <= 8) {
        await waitForRetry(250, signal);
        continue;
      }
      throw error;
    }

    if (signal?.aborted) {
      return;
    }
    if (sawTerminal) {
      return;
    }
    if (lastEventId !== undefined) {
      if (progressed) {
        reconnectAttempts = 0;
      } else if (++reconnectAttempts > 8) {
        throw new ChatRunStreamError("Chat stream ended before the response finished.", true);
      }
      await waitForRetry(250, signal);
      continue;
    }

    throw new ChatRunStreamError("Chat stream ended before the response finished.", true);
  }
};

const observeUntilTerminal = async function* (
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  let sawTerminal = false;

  for await (const chunk of stream) {
    if (isTerminalChunk(chunk)) {
      sawTerminal = true;
    }
    yield chunk;
  }

  if (!sawTerminal) {
    throw new ChatRunStreamError("Chat stream ended before the response finished.", true);
  }
};

export const consumeChatRunStream = async ({
  assistantMessageId,
  initialParts,
  onDraft,
  runId,
  signal,
}: {
  assistantMessageId: string;
  /** Latest known assistant parts (DB draft). Empty for a brand-new run. */
  initialParts?: ChatMessagePart[];
  onDraft: (input: { assistantMessageId: string; parts: ChatMessagePart[] }) => void;
  runId: string;
  signal?: AbortSignal;
}): Promise<ChatRunStreamDone> => {
  const seedParts =
    initialParts && initialParts.length > 0
      ? initialParts
      : [{ content: "", type: "text" as const }];

  // Paint current state immediately — dump-then-live SSE rebuilds the processor.
  onDraft({ assistantMessageId, parts: seedParts });

  let streamError: Error | null = null;

  const processor = new StreamProcessor({
    initialMessages: [
      {
        id: assistantMessageId,
        role: "assistant",
        parts: [{ content: "", type: "text" }] as UIMessage["parts"],
        createdAt: new Date(),
      },
    ],
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
    await processor.process(
      observeUntilTerminal(
        followChatRunEvents({
          runId,
          signal,
        }),
      ),
    );
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    if (error instanceof ChatRunStreamError) {
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
