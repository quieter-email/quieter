import { chat, toServerSentEventsResponse, type ModelMessage } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

export type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5" satisfies OpenRouterModel;
export const QUIETER_AI_APP_TITLE = "Quieter";

export type OpenRouterChatOptions = {
  messages: Array<ModelMessage>;
  apiKey?: string;
  model?: OpenRouterModel;
  httpReferer?: string;
  appTitle?: string;
};

export function createOpenRouterChatStream({
  messages,
  apiKey = process.env.OPENROUTER_API_KEY,
  model = DEFAULT_OPENROUTER_MODEL,
  httpReferer,
  appTitle = QUIETER_AI_APP_TITLE,
}: OpenRouterChatOptions) {
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return chat({
    adapter: createOpenRouterText(model, apiKey, {
      appTitle,
      httpReferer,
    }),
    messages,
  });
}

export function toOpenRouterChatResponse(options: OpenRouterChatOptions) {
  return toServerSentEventsResponse(createOpenRouterChatStream(options));
}
