import type { RouterOutputs } from "@quieter/orpc";
import type { MessagePart } from "@tanstack/ai";
import type { UIMessage } from "@tanstack/ai-react";
import type { AnyClientTool } from "@tanstack/ai/client";

type StoredMessage = RouterOutputs["chat"]["get"]["messages"][number];

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Every supported native part has a distinct runtime shape at this storage boundary.
// eslint-disable-next-line complexity
const toMessagePart = (value: unknown): MessagePart | null => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "text" && typeof value.content === "string") {
    return { content: value.content, type: "text" };
  }

  if (value.type === "thinking" && typeof value.content === "string") {
    return { content: value.content, type: "thinking" };
  }

  if (
    value.type === "tool-call" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.arguments === "string" &&
    isToolCallState(value.state)
  ) {
    const approval = isRecord(value.approval)
      ? {
          ...(typeof value.approval.approved === "boolean"
            ? { approved: value.approval.approved }
            : {}),
          id: typeof value.approval.id === "string" ? value.approval.id : "",
          needsApproval: value.approval.needsApproval === true,
        }
      : undefined;
    return {
      arguments: value.arguments,
      ...(approval !== undefined && approval.id !== "" ? { approval } : {}),
      id: value.id,
      ...(value.input === undefined ? {} : { input: value.input }),
      name: value.name,
      ...(value.output === undefined ? {} : { output: value.output }),
      state: value.state,
      type: "tool-call",
    };
  }

  if (
    value.type === "tool-result" &&
    typeof value.toolCallId === "string" &&
    typeof value.content === "string" &&
    isToolResultState(value.state)
  ) {
    return {
      content: value.content,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
      state: value.state,
      toolCallId: value.toolCallId,
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
