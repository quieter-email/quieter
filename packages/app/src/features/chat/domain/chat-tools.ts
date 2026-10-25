import type { CalendarWriteReview } from "@quieter/ai/chat-tools";
import type { UIMessage } from "ai";

export type ChatToolPart = Extract<
  UIMessage["parts"][number],
  { toolCallId: string }
>;

export const isChatToolPart = (
  part: UIMessage["parts"][number]
): part is ChatToolPart =>
  typeof part.type === "string" &&
  part.type.startsWith("tool-") &&
  part.type !== "tool-memory" &&
  part.type !== "tool-read_personal_context" &&
  part.type !== "tool-suggest_replies" &&
  "toolCallId" in part;

export const getToolName = (partType: string) =>
  partType.startsWith("tool-") ? partType.slice("tool-".length) : partType;

export type ChatToolApproval = {
  calendarReview?: CalendarWriteReview;
  approve: () => void;
  deny: () => void;
  id: string;
  toolCallId: string;
  toolName: string;
};

export const humanizeToolName = (name: string) =>
  name
    .replace(/^linear[-_:]?/u, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./u, (character) => character.toUpperCase());
