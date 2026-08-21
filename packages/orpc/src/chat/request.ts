import { chatModelSchema } from "@quieter/ai/chat-models";
import type { ChatMessagePart } from "@quieter/database/schema";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import type { MessagePart, RunAgentResumeItem, UIMessage } from "@tanstack/ai";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const runIdSchema = identifierSchema.regex(/^[\w:.-]+$/u);
const promptSchema = z.string().trim().min(1).max(10_000);
const contextSchema = z
  .object({
    messageId: z.string().trim().min(1).max(256).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    threadId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const CHAT_TITLE_LENGTH = 60;

export const createChatTitle = (prompt: string) => {
  const normalized = prompt.trim().replaceAll(/\s+/gu, " ");
  if (normalized.length <= CHAT_TITLE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, CHAT_TITLE_LENGTH).trimEnd()}...`;
};

export const chatForwardedPropsSchema = z
  .object({
    category: mailCategorySchema,
    context: contextSchema.optional(),
    mailboxId: identifierSchema,
    model: chatModelSchema,
  })
  .strict();

const clientUserMessageSchema = z
  .object({
    content: promptSchema,
    createdAt: z.union([z.string(), z.date()]).optional(),
    id: identifierSchema,
    parts: z
      .array(
        z
          .object({
            content: promptSchema,
            type: z.literal("text"),
          })
          .strict()
      )
      .length(1),
    role: z.literal("user"),
  })
  .strict()
  .refine((message) => message.content === message.parts[0]?.content, {
    message: "The user message content and text part must match.",
  });

type ValidatedChatRequestBase = {
  forwardedProps: z.infer<typeof chatForwardedPropsSchema>;
  runId: string;
  threadId: string;
};

export type ValidatedChatRequest = ValidatedChatRequestBase &
  (
    | {
        kind: "message";
        userMessage: {
          id: string;
          text: string;
        };
      }
    | {
        kind: "resume";
        parentRunId: string;
        resume: RunAgentResumeItem[];
      }
  );

const resumeItemSchema = z
  .object({
    interruptId: identifierSchema,
    payload: z.unknown().optional(),
    status: z.enum(["resolved", "cancelled"]),
  })
  .strict();

export const validateChatRequest = (params: {
  forwardedProps: Record<string, unknown>;
  messages: readonly unknown[];
  parentRunId?: string;
  resume?: readonly unknown[];
  runId: string;
  threadId: string;
}): ValidatedChatRequest => {
  const threadId = z.uuid().parse(params.threadId);
  const runId = runIdSchema.parse(params.runId);
  const forwardedProps = chatForwardedPropsSchema.parse(params.forwardedProps);
  const resume =
    params.resume === undefined
      ? undefined
      : z.array(resumeItemSchema).min(1).parse(params.resume);
  if (resume !== undefined) {
    return {
      forwardedProps,
      kind: "resume",
      parentRunId: runIdSchema.parse(params.parentRunId),
      resume,
      runId,
      threadId,
    };
  }
  if (params.parentRunId !== undefined) {
    throw new Error("A parent run id requires interrupt resume entries.");
  }
  const latestUserMessage = params.messages.findLast(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      Reflect.get(message, "role") === "user"
  );
  const userMessage = clientUserMessageSchema.parse(latestUserMessage);

  return {
    forwardedProps,
    kind: "message",
    runId,
    threadId,
    userMessage: {
      id: userMessage.id,
      text: userMessage.content,
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toolCallStates = new Set([
  "approval-requested",
  "approval-responded",
  "awaiting-input",
  "complete",
  "error",
  "input-complete",
  "input-streaming",
]);

const toolResultStates = new Set(["complete", "error", "streaming"]);

type ToolCallPart = Extract<MessagePart, { type: "tool-call" }>;
type ToolResultPart = Extract<MessagePart, { type: "tool-result" }>;

const isToolCallState = (value: unknown): value is ToolCallPart["state"] =>
  typeof value === "string" && toolCallStates.has(value);

const isToolResultState = (value: unknown): value is ToolResultPart["state"] =>
  typeof value === "string" && toolResultStates.has(value);

const toToolCallPart = (part: ChatMessagePart): ToolCallPart | null => {
  if (
    typeof part.id !== "string" ||
    typeof part.name !== "string" ||
    typeof part.arguments !== "string" ||
    !isToolCallState(part.state)
  ) {
    return null;
  }
  const approval = isRecord(part.approval)
    ? {
        ...(typeof part.approval.approved === "boolean"
          ? { approved: part.approval.approved }
          : {}),
        id: typeof part.approval.id === "string" ? part.approval.id : "",
        needsApproval: part.approval.needsApproval === true,
      }
    : undefined;
  return {
    arguments: part.arguments,
    ...(approval !== undefined && approval.id !== "" ? { approval } : {}),
    id: part.id,
    ...(part.input === undefined ? {} : { input: part.input }),
    name: part.name,
    ...(part.output === undefined ? {} : { output: part.output }),
    state: part.state,
    type: "tool-call",
  };
};

const toToolResultPart = (part: ChatMessagePart): ToolResultPart | null => {
  if (
    typeof part.toolCallId !== "string" ||
    typeof part.content !== "string" ||
    !isToolResultState(part.state)
  ) {
    return null;
  }
  return {
    content: part.content,
    ...(typeof part.error === "string" ? { error: part.error } : {}),
    state: part.state,
    toolCallId: part.toolCallId,
    type: "tool-result",
  };
};

const toCanonicalPart = (part: ChatMessagePart): MessagePart | null => {
  if (part.type === "text" && typeof part.content === "string") {
    return { content: part.content, type: "text" };
  }
  if (part.type === "thinking" && typeof part.content === "string") {
    return { content: part.content, type: "thinking" };
  }
  if (part.type === "tool-call") {
    return toToolCallPart(part);
  }
  if (part.type === "tool-result") {
    return toToolResultPart(part);
  }
  return null;
};

export const toCanonicalTranscript = (
  messages: readonly {
    createdAt: Date;
    id: string;
    parts: ChatMessagePart[];
    role: "assistant" | "system" | "user";
  }[]
): UIMessage[] =>
  messages.flatMap((message) => {
    if (message.role !== "assistant" && message.role !== "user") {
      return [];
    }
    const parts = message.parts.flatMap((part) => {
      const canonical = toCanonicalPart(part);
      return canonical === null ? [] : [canonical];
    });
    if (parts.length === 0) {
      return [];
    }
    return [
      {
        createdAt: message.createdAt,
        id: message.id,
        parts,
        role: message.role,
      },
    ];
  });
