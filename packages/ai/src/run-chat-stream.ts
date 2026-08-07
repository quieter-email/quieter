import {
  chat,
  EventType,
  maxIterations,
  StreamProcessor,
  type AnyTool,
  type ChatMiddleware,
  type StreamChunk,
  type StreamDurability,
  type UIMessage,
} from "@tanstack/ai";
import type { ChatModel } from "./chat-models";
import { createOpenRouterAdapter } from "./openrouter";

export const CHAT_AGENT_MAX_ITERATIONS = 12;
export const CHAT_AGENT_MAX_TOKENS = 4_096;
export const CHAT_STREAM_DURABILITY_BATCH = 8;

const isTerminalChunk = (chunk: StreamChunk) =>
  chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR;

const cancelledRunErrorChunk = (): StreamChunk => ({
  type: EventType.RUN_ERROR,
  timestamp: Date.now(),
  message: "Generation cancelled.",
  code: "cancelled",
  error: {
    code: "cancelled",
    message: "Generation cancelled.",
  },
});

/** Tee StreamChunks into a durability log and always close with a terminal event. */
export const streamChunksThroughDurability = async function* <TOffset extends string>({
  abortSignal,
  batchSize = CHAT_STREAM_DURABILITY_BATCH,
  durability,
  stream,
}: {
  abortSignal?: AbortSignal;
  batchSize?: number;
  durability: StreamDurability<TOffset>;
  stream: AsyncIterable<StreamChunk>;
}): AsyncGenerator<StreamChunk> {
  const batch: StreamChunk[] = [];
  let sawTerminal = false;

  const flush = async () => {
    if (batch.length === 0) {
      return;
    }

    const pending = batch.splice(0, batch.length);
    await durability.append(pending);
  };

  const enqueue = async (chunk: StreamChunk) => {
    if (isTerminalChunk(chunk)) {
      sawTerminal = true;
    }
    batch.push(chunk);
    if (batch.length >= batchSize) {
      await flush();
    }
  };

  try {
    for await (const chunk of stream) {
      await enqueue(chunk);
      yield chunk;
    }
  } finally {
    // Joiners require RUN_FINISHED / RUN_ERROR before close; chat() cancel often
    // ends the iterator without either, which would make clients reconnect forever.
    if (!sawTerminal) {
      await enqueue(
        abortSignal?.aborted
          ? cancelledRunErrorChunk()
          : ({
              type: EventType.RUN_ERROR,
              timestamp: Date.now(),
              message: "Generation stopped unexpectedly.",
              code: "incomplete",
              error: {
                code: "incomplete",
                message: "Generation stopped unexpectedly.",
              },
            } satisfies StreamChunk),
      ).catch(() => {});
    }
    await flush().catch(() => {});
    await durability.close();
  }
};

export const runChatStream = async ({
  abortController,
  durability,
  initialMessages,
  middleware,
  model,
  onMessagesChange,
  onToolCall,
  systemPrompts,
  tools,
}: {
  abortController?: AbortController;
  durability?: StreamDurability;
  initialMessages: UIMessage[];
  middleware?: ChatMiddleware[];
  model: ChatModel;
  onMessagesChange?: (messages: UIMessage[]) => void;
  onToolCall?: (input: { toolCallId: string; toolName: string }) => void;
  systemPrompts?: string[];
  tools?: AnyTool[];
}) => {
  const processor = new StreamProcessor({
    initialMessages,
    events: {
      onMessagesChange,
      onToolCall: (args) => {
        onToolCall?.({ toolCallId: args.toolCallId, toolName: args.toolName });
      },
    },
  });

  const stream = chat({
    abortController,
    adapter: createOpenRouterAdapter(model),
    agentLoopStrategy: maxIterations(CHAT_AGENT_MAX_ITERATIONS),
    messages: processor.getMessages(),
    middleware,
    modelOptions: {
      maxCompletionTokens: CHAT_AGENT_MAX_TOKENS,
      parallelToolCalls: true,
      reasoning: {
        effort: "medium",
      },
    },
    systemPrompts,
    tools,
  });

  const processable = durability
    ? streamChunksThroughDurability({
        abortSignal: abortController?.signal,
        durability,
        stream,
      })
    : stream;

  await processor.process(processable);
  return processor.getMessages();
};
