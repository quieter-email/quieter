import type { AnyTextAdapter } from "@tanstack/ai";
import { serverEnv } from "@quieter/env/server";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { defaultChatModel, type ChatModel } from "./chat-models";

type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];
type QuieterOpenRouterModel = ChatModel | "openai/gpt-5-nano";

const withZeroDataRetention = <TAdapter extends AnyTextAdapter>(adapter: TAdapter): TAdapter => {
  type ProviderOptions = TAdapter["~types"]["providerOptions"];
  type ProviderPreferences = ProviderOptions extends { provider?: infer TProvider }
    ? TProvider
    : Record<string, unknown>;

  const addProviderPreference = (modelOptions: ProviderOptions | undefined): ProviderOptions => {
    const current = (modelOptions ?? {}) as ProviderOptions & {
      provider?: ProviderPreferences;
    };

    return {
      ...current,
      provider: {
        ...current.provider,
        zdr: true,
      },
    } as ProviderOptions;
  };

  return {
    ...adapter,
    chatStream: (options: Parameters<TAdapter["chatStream"]>[0]) =>
      adapter.chatStream({
        ...options,
        modelOptions: addProviderPreference(options.modelOptions),
      }),
    structuredOutput: (options: Parameters<TAdapter["structuredOutput"]>[0]) =>
      adapter.structuredOutput({
        ...options,
        chatOptions: {
          ...options.chatOptions,
          modelOptions: addProviderPreference(options.chatOptions.modelOptions),
        },
      }),
    structuredOutputStream: adapter.structuredOutputStream
      ? (options: Parameters<NonNullable<TAdapter["structuredOutputStream"]>>[0]) =>
          adapter.structuredOutputStream?.({
            ...options,
            chatOptions: {
              ...options.chatOptions,
              modelOptions: addProviderPreference(options.chatOptions.modelOptions),
            },
          })
      : undefined,
  } as TAdapter;
};

export const createOpenRouterAdapter = (model: QuieterOpenRouterModel = defaultChatModel) => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("AI features are temporarily unavailable.");
  }

  // The generated provider model union can lag OpenRouter's live catalog.
  return withZeroDataRetention(
    createOpenRouterText(model as OpenRouterModel, apiKey, {
      appTitle: "quieter",
      httpReferer: "https://quieter.email",
    }),
  );
};
