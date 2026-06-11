import { createOpenRouterText } from "@tanstack/ai-openrouter";

const model: Parameters<typeof createOpenRouterText>[0] = "openai/gpt-5.4-nano";

export const createOpenRouterAdapter = () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  return createOpenRouterText(model, apiKey, {
    appTitle: "quieter",
    httpReferer: "https://quieter.email",
  });
};
