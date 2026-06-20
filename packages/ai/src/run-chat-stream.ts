import {
  chat,
  maxIterations,
  StreamProcessor,
  type ChatMiddleware,
  type ServerTool,
  type ToolDefinitionInstance,
  type UIMessage,
} from "@tanstack/ai";
import type { ChatModel } from "./chat-models";
import { createOpenRouterAdapter } from "./openrouter";

export const CHAT_AGENT_MAX_ITERATIONS = 6;
export const CHAT_AGENT_MAX_TOKENS = 4_096;

export const runChatStream = async ({
  abortController,
  initialMessages,
  middleware,
  model,
  onMessagesChange,
  onToolCall,
  systemPrompts,
  tools,
}: {
  abortController?: AbortController;
  initialMessages: UIMessage[];
  middleware?: ChatMiddleware[];
  model: ChatModel;
  onMessagesChange?: (messages: UIMessage[]) => void;
  onToolCall?: (input: { toolCallId: string; toolName: string }) => void;
  systemPrompts?: string[];
  tools?: Array<ServerTool | ToolDefinitionInstance>;
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
    maxTokens: CHAT_AGENT_MAX_TOKENS,
    messages: processor.getMessages(),
    middleware,
    modelOptions: {
      parallelToolCalls: true,
      reasoning: {
        effort: "medium",
      },
    },
    systemPrompts,
    tools,
  });

  await processor.process(stream);
  return processor.getMessages();
};
