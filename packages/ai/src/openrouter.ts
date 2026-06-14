import { serverEnv } from "@quieter/env/server";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { defaultChatModel, type ChatModel } from "./chat-models";

type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];
type QuieterOpenRouterModel = ChatModel | "openai/gpt-5-nano";

export const createOpenRouterAdapter = (model: QuieterOpenRouterModel = defaultChatModel) => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("AI features are temporarily unavailable.");
  }

  // The generated provider model union can lag OpenRouter's live catalog.
  return createOpenRouterText(model as OpenRouterModel, apiKey, {
    appTitle: "quieter",
    httpReferer: "https://quieter.email",
  });
};
