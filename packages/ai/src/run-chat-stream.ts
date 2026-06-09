import {
  chat,
  StreamProcessor,
  type ChatMiddleware,
  type ServerTool,
  type UIMessage,
} from "@tanstack/ai";
import { createOpenRouterAdapter } from "./index";

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
  tools?: ServerTool[];
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
    messages: processor.getMessages(),
    middleware,
    systemPrompts,
    tools,
  });

  const result = await processor.process(stream);

  return {
    messages: processor.getMessages(),
    result,
  };
};
