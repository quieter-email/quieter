import { serverEnv } from "@quieter/env/server";

import {
  chatModelSchema,
  defaultBackgroundModel,
  defaultChatModel,
} from "./chat-models";
import type { ChatModel } from "./chat-models";

/**
 * Resolves a configured model id against the catalog. Unset values fall back
 * to the matching default; misconfigured values fail loudly so bad secret
 * values surface at request time instead of silently downgrading.
 */
export const resolveConfiguredModel = (
  value: string | undefined,
  fallback: ChatModel
): ChatModel => {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = chatModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid model configuration: ${value}`);
  }
  return parsed.data;
};

/**
 * The model for interactive chat, configured through the QuieterChatModel
 * secret with the chat default as fallback. Server-only: clients never send
 * a model and must not import this module.
 */
export const resolveChatModel = (): ChatModel =>
  resolveConfiguredModel(serverEnv.QUIETER_CHAT_MODEL, defaultChatModel);

/**
 * The model for everything besides interactive chat, configured through the
 * QuieterBackgroundModel secret with the background default as fallback.
 * Server-only: clients never send a model and must not import this module.
 */
export const resolveBackgroundModel = (): ChatModel =>
  resolveConfiguredModel(
    serverEnv.QUIETER_BACKGROUND_MODEL,
    defaultBackgroundModel
  );
