import {
  chat,
  toServerSentEventsResponse,
  type ModelMessage,
  type ServerTool,
  type ChatMiddleware,
  type UIMessage,
} from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

export { chatParamsFromRequest, toolDefinition } from "@tanstack/ai";
export type { ChatMiddleware, ModelMessage, ServerTool, UIMessage } from "@tanstack/ai";

export type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];
export type ChatMessages = Array<UIMessage | ModelMessage>;

export const model = "openai/gpt-5.4-nano" as OpenRouterModel;
export const appTitle = "quieter";
export const httpReferer = "https://quieter.email";

export const createOpenRouterAdapter = () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  return createOpenRouterText(model, apiKey, { appTitle, httpReferer });
};

export const createChatResponse = ({
  messages,
  systemPrompts,
  tools,
  middleware,
}: {
  middleware?: ChatMiddleware[];
  messages: ChatMessages;
  systemPrompts?: string[];
  tools?: ServerTool[];
}) =>
  toServerSentEventsResponse(
    chat({
      adapter: createOpenRouterAdapter(),
      messages,
      middleware,
      systemPrompts,
      tools,
    }),
  );
