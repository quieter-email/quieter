"use client";

import { chatModelSchema, defaultChatModel, type ChatModel } from "@quieter/ai/chat-models";
import { useSyncExternalStore } from "react";

const DEFAULT_CHAT_MODEL_STORAGE_KEY = "quieter:default-chat-model";
const DEFAULT_CHAT_MODEL_CHANGE_EVENT = "quieter:default-chat-model-change";

const readDefaultChatModel = (): ChatModel => {
  if (typeof window === "undefined") return defaultChatModel;

  try {
    const storedModel = chatModelSchema.safeParse(
      window.localStorage.getItem(DEFAULT_CHAT_MODEL_STORAGE_KEY),
    );
    return storedModel.success ? storedModel.data : defaultChatModel;
  } catch {
    return defaultChatModel;
  }
};

const subscribeToDefaultChatModel = (callback: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEFAULT_CHAT_MODEL_STORAGE_KEY) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(DEFAULT_CHAT_MODEL_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(DEFAULT_CHAT_MODEL_CHANGE_EVENT, callback);
  };
};

export const setDefaultChatModel = (model: ChatModel) => {
  try {
    window.localStorage.setItem(DEFAULT_CHAT_MODEL_STORAGE_KEY, model);
  } catch {
    // Keep the in-memory default when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(DEFAULT_CHAT_MODEL_CHANGE_EVENT));
};

export const useDefaultChatModel = () =>
  useSyncExternalStore(subscribeToDefaultChatModel, readDefaultChatModel, () => defaultChatModel);
