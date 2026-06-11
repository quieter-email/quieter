import {
  chat,
  maxIterations,
  StreamProcessor,
  type ChatMiddleware,
  type ServerTool,
  type ToolDefinitionInstance,
  type UIMessage,
} from "@tanstack/ai";
import { createOpenRouterAdapter } from "./openrouter";

const CHAT_AGENT_MAX_ITERATIONS = 15;

export const runChatStream = async ({
  abortController,
  initialMessages,
  middleware,
  onMessagesChange,
  onToolCall,
  systemPrompts,
  tools,
}: {
  abortController?: AbortController;
  initialMessages: UIMessage[];
  middleware?: ChatMiddleware[];
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
    adapter: createOpenRouterAdapter(),
    agentLoopStrategy: maxIterations(CHAT_AGENT_MAX_ITERATIONS),
    maxTokens: 16_384,
    messages: processor.getMessages(),
    middleware,
    modelOptions: {
      parallelToolCalls: true,
      reasoning: {
        effort: "high",
      },
    },
    systemPrompts,
    tools,
  });

  await processor.process(stream);
  return processor.getMessages();
};
