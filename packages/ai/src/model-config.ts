import { serverEnv } from "@quieter/env/server";

import {
  chatModelSchema,
  chatModels,
  defaultBackgroundModel,
  defaultChatModel,
} from "./chat-models";
import type { ChatModel } from "./chat-models";

export const VERIFICATION_CODE_MODEL: ChatModel =
  "google/gemini-2.5-flash-lite";

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
 * Interactive choices use each family's native latest alias. Auto selects
 * the family configured by QuieterChatModel, including existing pinned ids.
 * Server-only: clients must not import this module.
 */
export const resolveChatModel = (selection?: ChatModel): ChatModel => {
  const configured =
    selection ??
    resolveConfiguredModel(serverEnv.QUIETER_CHAT_MODEL, defaultChatModel);
  const family = chatModels.find(
    ({ value, versions }) =>
      value === configured || versions.some((version) => version === configured)
  );
  if (family === undefined) {
    throw new Error("The selected model family is unavailable.");
  }
  return family.value;
};

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
