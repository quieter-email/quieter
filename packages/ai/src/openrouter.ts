import { serverEnv } from "@quieter/env/server";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { z } from "zod";

import { chatModelSchema, defaultChatModel } from "./chat-models";
import type { ChatModel } from "./chat-models";

type OpenRouterCatalogModel = Parameters<typeof createOpenRouterText>[0];
type OpenRouterTextAdapter = ReturnType<typeof createOpenRouterText>;
type OpenRouterProviderOptions =
  OpenRouterTextAdapter["~types"]["providerOptions"];

const isPresentString = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const openRouterModelSchema = z.custom<OpenRouterCatalogModel>(
  (value) => chatModelSchema.safeParse(value).success
);

const addProviderPreference = (
  modelOptions: OpenRouterProviderOptions | undefined
): OpenRouterProviderOptions => ({
  ...modelOptions,
  provider: {
    ...modelOptions?.provider,
    zdr: true,
  },
});

const withZeroDataRetention = (
  adapter: OpenRouterTextAdapter
): OpenRouterTextAdapter => {
  const originalChatStream = adapter.chatStream.bind(adapter);
  adapter.chatStream = (options) =>
    originalChatStream({
      ...options,
      modelOptions: addProviderPreference(options.modelOptions),
    });

  const originalStructuredOutput = adapter.structuredOutput.bind(adapter);
  adapter.structuredOutput = async (options) =>
    await originalStructuredOutput({
      ...options,
      chatOptions: {
        ...options.chatOptions,
        modelOptions: addProviderPreference(options.chatOptions.modelOptions),
      },
    });

  if (adapter.structuredOutputStream !== undefined) {
    const originalStructuredOutputStream =
      adapter.structuredOutputStream.bind(adapter);
    adapter.structuredOutputStream = (options) =>
      originalStructuredOutputStream({
        ...options,
        chatOptions: {
          ...options.chatOptions,
          modelOptions: addProviderPreference(options.chatOptions.modelOptions),
        },
      });
  }

  return adapter;
};

export const createOpenRouterAdapter = (
  model: ChatModel = defaultChatModel
) => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;

  if (!isPresentString(apiKey)) {
    throw new Error("AI features are temporarily unavailable.");
  }

  return withZeroDataRetention(
    createOpenRouterText(openRouterModelSchema.parse(model), apiKey, {
      appTitle: "quieter",
      httpReferer: "https://quieter.email",
    })
  );
};
