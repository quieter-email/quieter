import { composeEmailResultSchema } from "@quieter/ai/chat-agent";
import { chatModelSchema } from "@quieter/ai/chat-models";
import type { ChatMessagePart } from "@quieter/database/schema";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import type { UIMessage } from "ai";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(128);
const promptSchema = z.string().trim().min(1).max(10_000);
const contextSchema = z
  .object({
    messageId: z.string().trim().min(1).max(256).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    threadId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const CHAT_TITLE_LENGTH = 60;
const LINEAR_MENTION_PATTERN =
  /(?:^|[^\p{L}\p{N}_])@linear(?:$|[^\p{L}\p{N}_])/iu;

export const hasLinearConnectorMention = (text: string) =>
  LINEAR_MENTION_PATTERN.test(text);

export const createChatTitle = (prompt: string) => {
  const normalized = prompt.trim().replaceAll(/\s+/gu, " ");
  if (normalized.length <= CHAT_TITLE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, CHAT_TITLE_LENGTH).trimEnd()}...`;
};

const forwardedPropsSchema = z
  .object({
    category: mailCategorySchema,
    context: contextSchema.optional(),
    mailboxId: identifierSchema,
    model: chatModelSchema,
  })
  .strict();

const clientUserMessageSchema = z.object({
  id: identifierSchema,
  parts: z
    .array(
      z.looseObject({
        text: promptSchema,
        type: z.literal("text"),
      })
    )
    .min(1),
  role: z.literal("user"),
});

const clientAssistantMessageSchema = z.object({
  id: identifierSchema,
  parts: z.array(
    z.looseObject({
      state: z.string(),
      toolCallId: z.string().min(1),
      type: z.string().startsWith("tool-"),
    })
  ),
  role: z.literal("assistant"),
});

export type ValidatedChatRequestBase = {
  forwardedProps: z.infer<typeof forwardedPropsSchema>;
  threadId: string;
  trigger: "submit-message" | "regenerate-message";
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
        assistantMessageId: string;
        kind: "continue";
        toolDecisions: Map<string, boolean>;
        toolOutputs: Map<string, unknown>;
      }
    | {
        kind: "regenerate";
      }
  );

const chatRequestBodySchema = z
  .object({
    category: mailCategorySchema,
    context: contextSchema.optional(),
    mailboxId: identifierSchema,
    message: z.unknown(),
    model: chatModelSchema,
    threadId: z.uuid(),
    trigger: z.enum(["submit-message", "regenerate-message"]),
  })
  .strict();

/**
 * Validates the transport body sent by `DefaultChatTransport`. Only the last
 * client message is inspected: the transcript itself is rebuilt from the
 * database, so a tampered history cannot influence the model.
 */
export const validateChatRequest = (body: unknown): ValidatedChatRequest => {
  const parsedBody = chatRequestBodySchema.parse(body);
  const { threadId } = parsedBody;
  const forwardedProps = forwardedPropsSchema.parse({
    category: parsedBody.category,
    ...(parsedBody.context === undefined
      ? {}
      : { context: parsedBody.context }),
    mailboxId: parsedBody.mailboxId,
    model: parsedBody.model,
  });

  if (parsedBody.trigger === "regenerate-message") {
    return {
      forwardedProps,
      kind: "regenerate",
      threadId,
      trigger: parsedBody.trigger,
    };
  }

  const messageRole = z
    .looseObject({ role: z.string() })
    .parse(parsedBody.message).role;

  if (messageRole === "user") {
    const userMessage = clientUserMessageSchema.parse(parsedBody.message);
    if (userMessage.parts.length !== 1) {
      throw new z.ZodError([
        {
          code: "custom",
          message: "The chat message must contain exactly one text part.",
          path: ["message", "parts"],
        },
      ]);
    }
    return {
      forwardedProps,
      kind: "message",
      threadId,
      trigger: parsedBody.trigger,
      userMessage: {
        id: userMessage.id,
        text: userMessage.parts[0]?.text ?? "",
      },
    };
  }

  const assistantMessage = clientAssistantMessageSchema.parse(
    parsedBody.message
  );
  const toolDecisions = new Map<string, boolean>();
  const toolOutputs = new Map<string, unknown>();
  for (const part of assistantMessage.parts) {
    if (part.state === "approval-responded") {
      const approval = z
        .looseObject({ approved: z.boolean(), id: z.string().min(1) })
        .parse(part.approval);
      toolDecisions.set(part.toolCallId, approval.approved);
    } else if (part.state === "output-available") {
      // Compose proposals are the only client-resolved tools; anything else
      // claiming a client-side result is untrusted input.
      if (part.type !== "tool-compose_email") {
        throw new z.ZodError([
          {
            code: "custom",
            message: "This tool result cannot be supplied by the client.",
            path: ["message", "parts"],
          },
        ]);
      }
      toolOutputs.set(
        part.toolCallId,
        composeEmailResultSchema.parse(part.output)
      );
    }
  }
  if (toolDecisions.size === 0 && toolOutputs.size === 0) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "The assistant message carries no client resolutions.",
        path: ["message"],
      },
    ]);
  }

  return {
    assistantMessageId: assistantMessage.id,
    forwardedProps,
    kind: "continue",
    threadId,
    toolDecisions,
    toolOutputs,
    trigger: parsedBody.trigger,
  };
};

type UIMessagePart = UIMessage["parts"][number];

const isRenderablePart = (part: ChatMessagePart): boolean => {
  if (part.type === "text") {
    return typeof part.text === "string";
  }
  if (part.type === "") {
    return false;
  }
  if (part.type === "step-start") {
    return true;
  }
  return part.type.startsWith("tool-") && typeof part.toolCallId === "string";
};

/**
 * Maps persisted message rows onto AI SDK UI messages. Parts are stored in
 * their native UI message shape, so this only drops malformed entries.
 */
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
    const parts = message.parts.filter(isRenderablePart);
    if (parts.length === 0) {
      return [];
    }
    return [
      {
        id: message.id,
        // Parts round-trip as opaque JSON; convertToModelMessages validates
        // the shapes it consumes.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        parts: parts as UIMessagePart[],
        role: message.role,
      } satisfies UIMessage,
    ];
  });
