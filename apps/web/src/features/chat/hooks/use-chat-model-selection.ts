"use client";

import type { ChatModel } from "@quieter/ai/chat-models";
import { useState } from "react";

import { setDefaultChatModel } from "#/features/ai/domain/default-chat-model-setting";

import type { ChatQueryData } from "../lib/chat-view-helpers";

export const useChatModelSelection = ({
  chatData,
  chatKey,
  defaultModel,
}: {
  chatData: ChatQueryData | undefined;
  chatKey: string;
  defaultModel: ChatModel;
}) => {
  const [modelSelection, setModelSelection] = useState<{
    chatKey: string;
    model: ChatModel;
  } | null>(null);
  const selectedModel = modelSelection?.model;
  const selectedChatKey = modelSelection?.chatKey;
  let model = defaultModel;
  if (selectedChatKey === chatKey && selectedModel !== undefined) {
    model = selectedModel;
  } else if (
    (chatData?.messages.length ?? 0) > 0 &&
    chatData?.lastModel !== null &&
    chatData?.lastModel !== undefined
  ) {
    model = chatData.lastModel;
  }

  const handleModelChange = (nextModel: ChatModel) => {
    setDefaultChatModel(nextModel);
    setModelSelection({ chatKey, model: nextModel });
  };

  return { handleModelChange, model };
};
