import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "@tanstack/ai";
import type { UseMutationResult } from "@tanstack/react-query";

import type { ChatTurn } from "../types";

export type ChatQueryData = RouterOutputs["chat"]["get"];
export type ChatsQueryData = RouterOutputs["chat"]["list"];
export type StoredChatMessage = ChatQueryData["messages"][number];
export type ActiveChatRun = ChatQueryData["activeRun"];
export type ChatRunStartResult = RouterOutputs["chat"]["sendMessage"];

export const PENDING_TURN_ID = "pending-turn";
export const MAX_TRANSCRIPTION_AUDIO_DURATION_MS = 60_000;
export const MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH = 14_000_000;

export const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

export const isUiMessagePartArray = (
  value: unknown
): value is UIMessage["parts"] => Array.isArray(value);

export const isActiveRun = (activeRun: ActiveChatRun | null | undefined) =>
  !!activeRun &&
  (activeRun.status === "queued" ||
    activeRun.status === "running" ||
    activeRun.status === "waiting_on_tool");

export const normalizeChatMessages = (
  messages: StoredChatMessage[]
): UIMessage[] =>
  messages.map((message) => ({
    createdAt:
      message.createdAt === null || message.createdAt === undefined
        ? undefined
        : new Date(message.createdAt),
    id: message.id,
    parts: isUiMessagePartArray(message.parts) ? message.parts : [],
    role: message.role,
  }));

export type PendingPrompt = {
  chatKey: string;
  mailboxId: string;
  text: string;
} | null;

export const createPendingTurn = (
  pendingPrompt: PendingPrompt,
  chatKey: string,
  mailboxId: string
): ChatTurn | null => {
  if (
    pendingPrompt === null ||
    pendingPrompt.chatKey !== chatKey ||
    pendingPrompt.mailboxId !== mailboxId
  ) {
    return null;
  }

  return {
    assistant: {
      id: `${PENDING_TURN_ID}:assistant`,
      parts: [],
      role: "assistant",
    },
    id: PENDING_TURN_ID,
    user: {
      id: `${PENDING_TURN_ID}:user`,
      parts: [{ content: pendingPrompt.text, type: "text" }],
      role: "user",
    },
  };
};

export type ChatViewMutationSet = {
  cancelGenerationMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["cancelGeneration"],
      unknown,
      RouterInputs["chat"]["cancelGeneration"]
    >,
    "isPending" | "mutateAsync"
  >;
  createChatMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["create"],
      unknown,
      RouterInputs["chat"]["create"]
    >,
    "isPending" | "mutateAsync"
  >;
  editUserMessageMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["editUserMessage"],
      unknown,
      RouterInputs["chat"]["editUserMessage"]
    >,
    "isPending" | "mutateAsync"
  >;
  generateTitleMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["generateTitle"],
      unknown,
      RouterInputs["chat"]["generateTitle"]
    >,
    "mutate"
  >;
  regenerateResponseMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["regenerateResponse"],
      unknown,
      RouterInputs["chat"]["regenerateResponse"]
    >,
    "isPending" | "mutateAsync"
  >;
  resolveComposeToolMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["resolveComposeTool"],
      unknown,
      RouterInputs["chat"]["resolveComposeTool"]
    >,
    "isPending" | "mutateAsync"
  >;
  sendMessageMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["sendMessage"],
      unknown,
      RouterInputs["chat"]["sendMessage"]
    >,
    "isPending" | "mutateAsync"
  >;
  transcribeAudioMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["transcribeAudio"],
      unknown,
      RouterInputs["chat"]["transcribeAudio"]
    >,
    "isPending" | "mutateAsync"
  >;
};

export const hasPendingChatAction = (mutations: ChatViewMutationSet) =>
  mutations.createChatMutation.isPending ||
  mutations.sendMessageMutation.isPending ||
  mutations.cancelGenerationMutation.isPending ||
  mutations.editUserMessageMutation.isPending ||
  mutations.regenerateResponseMutation.isPending ||
  mutations.resolveComposeToolMutation.isPending;

export const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};
