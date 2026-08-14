import type {
  ChatMessagePart,
  ChatRunStatus,
} from "@quieter/orpc/chat-contracts";
import { EventType, StreamProcessor } from "@tanstack/ai";
import type { StreamChunk, UIMessage } from "@tanstack/ai";

import { delay } from "#/lib/delay";

export type ChatRunStreamDone = {
  assistantMessageId: string;
  error?: string | null;
  parts: ChatMessagePart[];
  status: ChatRunStatus;
};

export class ChatRunStreamError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ChatRunStreamError";
    this.retryable = retryable;
  }
}

const isChatMessagePartArray = (value: unknown): value is ChatMessagePart[] =>
  Array.isArray(value);

const getAssistantParts = (messages: UIMessage[]): ChatMessagePart[] => {
  const parts = messages.flatMap((message) => {
    if (message.role !== "assistant") {
      return [];
    }
    const messageParts = message.parts;
    return isChatMessagePartArray(messageParts) ? messageParts : [];
  });
  return parts.length > 0 ? parts : [{ content: "", type: "text" }];
};

const statusFromStreamError = (
  error: Error | null
): {
  error?: string | null;
  status: ChatRunStatus;
} => {
  if (error === null) {
    return { status: "complete" };
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code === "cancelled" || /cancel/iu.test(error.message)) {
    return { error: null, status: "cancelled" };
  }

  return {
    error:
      error.message === "" ? "The response could not finish." : error.message,
    status: "failed",
  };
};

const isTerminalChunk = (chunk: StreamChunk) =>
  chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR;

const waitForRetry = async (ms: number, signal?: AbortSignal) => {
  await delay(ms, signal);
};

type SseEvent = {
  chunk: StreamChunk;
  id?: string;
};

const isStreamChunk = (value: unknown): value is StreamChunk =>
  typeof value === "object" && value !== null && "type" in value;

const parseSseDataLine = (line: string): StreamChunk | null | "done" => {
  if (!line.startsWith("data:") && !line.startsWith("data: ")) {
    return null;
  }

  const data = line.startsWith("data: ")
    ? line.slice(6)
    : line.slice(5).trimStart();
  if (data === "[DONE]") {
    return "done";
  }

  const parsed: unknown = JSON.parse(data);
  if (!isStreamChunk(parsed)) {
    return null;
  }
  return parsed;
};

const processSseLine = (
  line: string,
  pendingId: string | undefined
): { event?: SseEvent; done?: boolean; pendingId?: string } => {
  if (line === "") {
    return { pendingId };
  }
  if (
    line.startsWith(":") ||
    line.startsWith("event:") ||
    line.startsWith("retry:")
  ) {
    return { pendingId };
  }
  if (line === "id" || line.startsWith("id:")) {
    const rawId = line === "id" ? "" : line.slice(3);
    const nextId = rawId.startsWith(" ") ? rawId.slice(1) : rawId;
    return { pendingId: nextId };
  }

  const chunk = parseSseDataLine(line);
  if (chunk === "done") {
    return { done: true, pendingId: undefined };
  }
  if (chunk === null) {
    if (line.startsWith("data:")) {
      return { done: true, pendingId: undefined };
    }
    return { pendingId };
  }

  const id = pendingId;
  const event: SseEvent =
    id === undefined || id === "" ? { chunk } : { chunk, id };
  return { event, pendingId: undefined };
};

const readSseChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined
): Promise<{ done: boolean; value?: Uint8Array }> => {
  if (signal?.aborted === true) {
    return { done: true };
  }
  return await reader.read();
};

/**
 * Minimal SSE reader for the observation endpoint (supports id: + data:).
 * @yields {SseEvent} Parsed SSE events from the stream body.
 */
export const readSseEvents = async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    let buffer = "";
    let pendingId: string | undefined;
    let streamDone = false;

    while (!streamDone) {
      // Stream reads are ordered; starting the next read early can reorder chunks.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const { done, value } = await readSseChunk(reader, signal);
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        const {
          done: eventDone,
          event,
          pendingId: nextPendingId,
        } = processSseLine(line, pendingId);
        pendingId = nextPendingId;
        if (eventDone === true) {
          streamDone = true;
          break;
        }
        if (event !== undefined) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};

const openChatRunStream = async ({
  runId,
  signal,
  lastEventId,
}: {
  runId: string;
  signal?: AbortSignal;
  lastEventId?: string;
}): Promise<Response> => {
  const url = new URL(
    `/api/chat/runs/${encodeURIComponent(runId)}/stream`,
    window.location.origin
  );
  url.searchParams.set("runId", runId);

  const headers = new Headers();
  if ((lastEventId ?? "") !== "") {
    headers.set("Last-Event-ID", lastEventId ?? "");
  }

  return await fetch(url, {
    credentials: "include",
    headers,
    method: "GET",
    signal,
  });
};

const consumeSseResponse = async function* consumeSseResponse(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw new ChatRunStreamError("Chat stream returned no body.", true);
  }

  for await (const event of readSseEvents(response.body, signal)) {
    yield event;
  }
};

const shouldReconnectAfterStreamError = (
  lastEventId: string | undefined,
  reconnectAttempts: number
): boolean => lastEventId !== undefined && reconnectAttempts + 1 <= 8;

type FollowChatRunState = {
  lastEventId?: string;
  reconnectAttempts: number;
  seen: Set<string>;
};

const followChatRunEventsStep = async function* followChatRunEventsStep({
  runId,
  signal,
  state,
}: {
  runId: string;
  signal?: AbortSignal;
  state: FollowChatRunState;
}): AsyncGenerator<StreamChunk> {
  const consumeResponse = async function* consumeResponse(response: Response) {
    let sawTerminal = false;
    let progressed = false;

    try {
      for await (const event of consumeSseResponse(response, signal)) {
        if (event.id !== undefined) {
          if (state.seen.has(event.id)) {
            continue;
          }
          state.seen.add(event.id);
          state.lastEventId = event.id;
        }
        progressed = true;
        state.reconnectAttempts = 0;
        if (isTerminalChunk(event.chunk)) {
          sawTerminal = true;
        }
        yield event.chunk;
      }
    } catch (error) {
      if (signal !== undefined && signal.aborted) {
        return;
      }
      if (
        shouldReconnectAfterStreamError(
          state.lastEventId,
          state.reconnectAttempts
        )
      ) {
        state.reconnectAttempts += 1;
        await waitForRetry(250, signal);
        yield* followChatRunEventsStep({ runId, signal, state });
        return;
      }
      throw error;
    }

    if (signal !== undefined && signal.aborted) {
      return;
    }
    if (sawTerminal) {
      return;
    }
    if (state.lastEventId === undefined) {
      throw new ChatRunStreamError(
        "Chat stream ended before the response finished.",
        true
      );
    }

    if (progressed) {
      state.reconnectAttempts = 0;
    } else {
      state.reconnectAttempts += 1;
      if (state.reconnectAttempts > 8) {
        throw new ChatRunStreamError(
          "Chat stream ended before the response finished.",
          true
        );
      }
    }
    await waitForRetry(250, signal);
    yield* followChatRunEventsStep({ runId, signal, state });
  };

  if (signal !== undefined && signal.aborted) {
    return;
  }

  let response: Response;
  try {
    response = await openChatRunStream({
      lastEventId: state.lastEventId,
      runId,
      signal,
    });
  } catch (error) {
    if (signal !== undefined && signal.aborted) {
      return;
    }
    state.reconnectAttempts += 1;
    if (state.reconnectAttempts > 8) {
      throw error;
    }
    await waitForRetry(250, signal);
    yield* followChatRunEventsStep({ runId, signal, state });
    return;
  }

  if (!response.ok) {
    throw new ChatRunStreamError(
      response.status === 401 || response.status === 403
        ? "Unauthorized"
        : `Chat stream failed (${response.status}).`,
      response.status !== 401 && response.status !== 403
    );
  }

  yield* consumeResponse(response);
};

/**
 * Follow a run's live delivery stream (dump-then-live).
 * Reconnects after a drop until a terminal chunk arrives.
 * @yields {StreamChunk} Stream chunks from the chat run SSE connection.
 */
const followChatRunEvents = async function* followChatRunEvents({
  runId,
  signal,
}: {
  runId: string;
  signal?: AbortSignal;
}): AsyncGenerator<StreamChunk> {
  const state: FollowChatRunState = {
    reconnectAttempts: 0,
    seen: new Set<string>(),
  };
  yield* followChatRunEventsStep({ runId, signal, state });
};

/**
 * Observe stream chunks until a terminal chunk is received.
 * @yields {StreamChunk} Stream chunks from the input async iterable.
 */
const observeUntilTerminal = async function* observeUntilTerminal(
  stream: AsyncIterable<StreamChunk>
): AsyncGenerator<StreamChunk> {
  let sawTerminal = false;

  for await (const chunk of stream) {
    if (isTerminalChunk(chunk)) {
      sawTerminal = true;
    }
    yield chunk;
  }

  if (!sawTerminal) {
    throw new ChatRunStreamError(
      "Chat stream ended before the response finished.",
      true
    );
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
  onDraft: (input: {
    assistantMessageId: string;
    parts: ChatMessagePart[];
  }) => void;
  runId: string;
  signal?: AbortSignal;
}): Promise<ChatRunStreamDone> => {
  const seedParts =
    initialParts !== undefined && initialParts.length > 0
      ? initialParts
      : [{ content: "", type: "text" as const }];

  onDraft({ assistantMessageId, parts: seedParts });

  let streamError: Error | null = null;

  const processor = new StreamProcessor({
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
    initialMessages: [
      {
        createdAt: new Date(),
        id: assistantMessageId,
        parts: [{ content: "", type: "text" }] as UIMessage["parts"],
        role: "assistant",
      },
    ],
  });

  try {
    await processor.process(
      observeUntilTerminal(
        followChatRunEvents({
          runId,
          signal,
        })
      )
    );
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }

    if (error instanceof ChatRunStreamError) {
      throw error;
    }

    const message =
      error instanceof Error && (error.message ?? "") !== ""
        ? error.message
        : "Could not open the chat stream.";
    const unauthorized =
      error instanceof Error && /401|403|Unauthorized/iu.test(error.message);
    throw new ChatRunStreamError(message, !unauthorized);
  }

  if (signal?.aborted === true) {
    throw new DOMException("Aborted", "AbortError");
  }

  return {
    assistantMessageId,
    parts: getAssistantParts(processor.getMessages()),
    ...statusFromStreamError(streamError),
  };
};
