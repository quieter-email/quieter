import { chat, EventType, maxIterations, StreamProcessor } from "@tanstack/ai";
import type {
  AnyTool,
  ChatMiddleware,
  StreamChunk,
  StreamDurability,
  UIMessage,
} from "@tanstack/ai";

import type { ChatModel } from "./chat-models";
import { createOpenRouterAdapter } from "./openrouter";

export const CHAT_AGENT_MAX_ITERATIONS = 12;
export const CHAT_AGENT_MAX_TOKENS = 4096;
/** Flush every chunk so SSE observers see tokens live, not in multi-second batches. */
export const CHAT_STREAM_DURABILITY_BATCH = 1;

const isTerminalChunk = (chunk: StreamChunk) =>
  chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR;

const cancelledRunErrorChunk = (): StreamChunk => ({
  code: "cancelled",
  message: "Generation cancelled.",
  timestamp: Date.now(),
  type: EventType.RUN_ERROR,
});

/** @yields {StreamChunk} Stream chunks mirrored into durability storage. */
export const streamChunksThroughDurability =
  async function* streamChunksThroughDurability<TOffset extends string>({
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

      // Keep chunks in `batch` until append succeeds so a rejected append can retry.
      const pending = [...batch];
      await durability.append(pending);
      batch.splice(0, pending.length);
    };

    const enqueue = async (chunk: StreamChunk) => {
      if (isTerminalChunk(chunk)) {
        sawTerminal = true;
      }
      batch.push(chunk);
      if (batch.length >= batchSize || isTerminalChunk(chunk)) {
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
          abortSignal?.aborted === true
            ? cancelledRunErrorChunk()
            : ({
                code: "incomplete",
                message: "Generation stopped unexpectedly.",
                timestamp: Date.now(),
                type: EventType.RUN_ERROR,
              } satisfies StreamChunk)
        );
      }

      // A rejected flush must leave the log open for recovery; do not close after it.
      await flush();
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
    events: {
      onMessagesChange,
      onToolCall: (args) => {
        onToolCall?.({ toolCallId: args.toolCallId, toolName: args.toolName });
      },
    },
    initialMessages,
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
