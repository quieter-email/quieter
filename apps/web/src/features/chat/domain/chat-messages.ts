import type { ChatMessagePart } from "@quieter/database/schema";
import type { RouterOutputs } from "@quieter/orpc";
import type { MessagePart } from "@tanstack/ai";
import type { UIMessage } from "@tanstack/ai-react";
import type { AnyClientTool } from "@tanstack/ai/client";
import { z } from "zod";

type StoredMessage = RouterOutputs["chat"]["get"]["messages"][number];

const storedToolApprovalSchema = z.object({
  approved: z.boolean().optional(),
  id: z.string().min(1),
  needsApproval: z.boolean(),
});

type ToolCallState = Extract<MessagePart, { type: "tool-call" }>["state"];
type ToolResultState = Extract<MessagePart, { type: "tool-result" }>["state"];

const isToolCallState = (value: unknown): value is ToolCallState =>
  value === "awaiting-input" ||
  value === "input-streaming" ||
  value === "input-complete" ||
  value === "approval-requested" ||
  value === "approval-responded" ||
  value === "complete" ||
  value === "error";

const isToolResultState = (value: unknown): value is ToolResultState =>
  value === "streaming" || value === "complete" || value === "error";

// Every supported native part has a distinct runtime shape at this storage boundary.
const toMessagePart = (part: ChatMessagePart): MessagePart | null => {
  if (part.type === "text" && typeof part.content === "string") {
    return { content: part.content, type: "text" };
  }

  if (part.type === "thinking" && typeof part.content === "string") {
    return { content: part.content, type: "thinking" };
  }

  if (
    part.type === "tool-call" &&
    typeof part.id === "string" &&
    typeof part.name === "string" &&
    typeof part.arguments === "string" &&
    isToolCallState(part.state)
  ) {
    const approval = storedToolApprovalSchema.safeParse(part.approval);
    return {
      arguments: part.arguments,
      ...(approval.success ? { approval: approval.data } : {}),
      id: part.id,
      ...(part.input === undefined ? {} : { input: part.input }),
      name: part.name,
      ...(part.output === undefined ? {} : { output: part.output }),
      state: part.state,
      type: "tool-call",
    };
  }

  if (
    part.type === "tool-result" &&
    typeof part.toolCallId === "string" &&
    typeof part.content === "string" &&
    isToolResultState(part.state)
  ) {
    return {
      content: part.content,
      ...(typeof part.error === "string" ? { error: part.error } : {}),
      state: part.state,
      toolCallId: part.toolCallId,
      type: "tool-result",
    };
  }

  return null;
};

export const toInitialMessages = <
  TTools extends readonly AnyClientTool[] = readonly AnyClientTool[],
>(
  messages: StoredMessage[]
): UIMessage<TTools>[] =>
  messages.map((message) => ({
    createdAt:
      message.createdAt === null || message.createdAt === undefined
        ? undefined
        : new Date(message.createdAt),
    id: message.id,
    parts: message.parts.flatMap((part) => {
      const normalized = toMessagePart(part);
      // Persisted parts are shape-validated above but cannot statically prove
      // the registered tool-name literals of the caller's tool tuple.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return (
        normalized === null ? [] : [normalized]
      ) as UIMessage<TTools>["parts"];
    }),
    role: message.role,
  }));

export const getMessageText = (parts: MessagePart[]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && part.content.trim() ? [part.content.trim()] : []
    )
    .join("\n\n");

export const getAssistantProgress = (
  parts: MessagePart[],
  isStreaming: boolean
) => {
  if (!isStreaming) {
    return null;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "text" && part.content.trim()) {
      return null;
    }
    if (part?.type === "tool-call" || part?.type === "tool-result") {
      return "Working with your mail…";
    }
    if (part?.type === "thinking" && part.content.trim()) {
      return "Thinking…";
    }
  }

  return "Thinking…";
};
