import { serverEnv } from "@quieter/env/server";

import {
  chatModelSchema,
  chatModels,
  defaultBackgroundModel,
  defaultChatModel,
  retiredChatModelSchema,
} from "./chat-models";
import type { ChatModel } from "./chat-models";

/**
 * Unset and retired model ids use the default. Unknown ids surface as
 * configuration errors.
 */
export const resolveConfiguredModel = (
  value: string | undefined,
  fallback: ChatModel
): ChatModel => {
  if (
    value === undefined ||
    value === "" ||
    retiredChatModelSchema.safeParse(value).success
  ) {
    return fallback;
  }
  const parsed = chatModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid model configuration: ${value}`);
  }
  return parsed.data;
};

/**
 * Interactive choices use the picker catalog. Auto follows QuieterChatModel,
 * with older identifiers resolved to the corresponding picker choice.
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
 * The shared background model. Automatic memory consolidation uses its own
 * priced route. Configure the shared model through QuieterBackgroundModel.
 * Server-only: clients never send a model and must not import this module.
 */
export const resolveBackgroundModel = (): ChatModel =>
  resolveConfiguredModel(
    serverEnv.QUIETER_BACKGROUND_MODEL,
    defaultBackgroundModel
  );
