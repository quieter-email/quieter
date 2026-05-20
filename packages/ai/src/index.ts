import { createOpenRouterText } from "@tanstack/ai-openrouter";

export type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];

export const model = "openrouter/free" satisfies OpenRouterModel;
export const appTitle = "quieter";
export const httpReferer = "https://quieter.email";

export const adapter = createOpenRouterText(model, process.env.OPENROUTER_API_KEY as string, {
  appTitle,
  httpReferer,
});
