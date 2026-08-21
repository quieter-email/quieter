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
  "toolCallId" in part;

export const getToolName = (partType: string) =>
  partType.startsWith("tool-") ? partType.slice("tool-".length) : partType;

export type ChatToolApproval = {
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
