import { ORPCError } from "@orpc/server";
import {
  composeEmailResultSchema,
  createAiMemoryChatTool,
  createComposeEmailChatTool,
  createGmailChatTools,
  createGoogleCalendarChatTool,
  gmailToolsPrompt,
  googleCalendarToolsPrompt,
  linearToolsPrompt,
} from "@quieter/ai/chat-agent";
import type {
  AiMemoryToolsContext,
  GmailToolsContext,
} from "@quieter/ai/chat-agent";
import { CHAT_TITLE_MODEL, chatModelSchema } from "@quieter/ai/chat-models";
import { summarizeAiUsage } from "@quieter/ai/chat-usage";
import { createChatModel } from "@quieter/ai/openrouter";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { chat as chatTable, chatMessage } from "@quieter/database/schema";
import type { ChatMessagePart } from "@quieter/database/schema";
import type { MailboxCategory } from "@quieter/gmail";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type { UIMessage } from "ai";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  loadAiAgentContext,
  requestAiMemoryUpdate,
  serializeAiAgentContext,
} from "../ai-memory";
import {
  createGoogleCalendarEventForUser,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  hasConnectedConnector,
} from "../connectors/runtime";
import {
  getMailboxOverviewForUser,
  listGmailLabelsForUser,
  modifyMailForUser,
  readGmailAttachmentForUser,
  readGmailMessageForUser,
  readGmailMessagesForUser,
  readGmailThreadForUser,
  searchGmailForUser,
} from "../gmail-chat-search";
import { assertAccessibleMailbox } from "../mailbox/service";
import { assertAiChatCredits } from "./access";
import { createLinearChatTools } from "./linear-tools";

const CHAT_HISTORY_WINDOW_MESSAGES = 30;
const CHAT_MAX_COMPLETION_TOKENS = 2048;
const MAIL_TOOL_TIMEOUT_MS = 25_000;

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

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

export const createChatTitle = (prompt: string) => {
  const normalized = prompt.trim().replaceAll(/\s+/gu, " ");
  if (normalized.length <= CHAT_TITLE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, CHAT_TITLE_LENGTH).trimEnd()}...`;
};

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
  // Assistant messages stream as mixed content (step-start, text, tool
  // parts); only the tool parts carry client-resolvable decisions.
  parts: z.array(z.record(z.string(), z.unknown())),
  role: z.literal("assistant"),
});

type ValidatedChatRequestBase = {
  category: MailboxCategory;
  context?: z.infer<typeof contextSchema>;
  mailboxId: string;
  model: z.infer<typeof chatModelSchema>;
  threadId: string;
  trigger: "submit-message" | "regenerate-message";
};

type ValidatedChatRequest = ValidatedChatRequestBase &
  (
    | {
        kind: "message";
        userMessage: { id: string; text: string };
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

export const validateChatRequest = (body: unknown): ValidatedChatRequest => {
  const parsedBody = chatRequestBodySchema.parse(body);
  const { threadId } = parsedBody;

  if (parsedBody.trigger === "regenerate-message") {
    return {
      category: parsedBody.category,
      ...(parsedBody.context === undefined
        ? {}
        : { context: parsedBody.context }),
      kind: "regenerate",
      mailboxId: parsedBody.mailboxId,
      model: parsedBody.model,
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
      category: parsedBody.category,
      ...(parsedBody.context === undefined
        ? {}
        : { context: parsedBody.context }),
      kind: "message",
      mailboxId: parsedBody.mailboxId,
      model: parsedBody.model,
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
    const type: unknown = part.type;
    if (typeof type !== "string" || !type.startsWith("tool-")) {
      // Text, step-start, and other streamed parts ride along untouched.
      continue;
    }
    const toolPart = z
      .looseObject({ state: z.string(), toolCallId: z.string().min(1) })
      .parse(part);
    if (toolPart.state === "approval-responded") {
      const approval = z
        .looseObject({ approved: z.boolean(), id: z.string().min(1) })
        .parse(part.approval);
      toolDecisions.set(toolPart.toolCallId, approval.approved);
    } else if (toolPart.state === "output-available") {
      // Compose proposals are the only client-resolved tools; anything else
      // claiming a client-side result is untrusted input.
      if (type !== "tool-compose_email") {
        throw new z.ZodError([
          {
            code: "custom",
            message: "This tool result cannot be supplied by the client.",
            path: ["message", "parts"],
          },
        ]);
      }
      toolOutputs.set(
        toolPart.toolCallId,
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
    category: parsedBody.category,
    ...(parsedBody.context === undefined
      ? {}
      : { context: parsedBody.context }),
    kind: "continue",
    mailboxId: parsedBody.mailboxId,
    model: parsedBody.model,
    threadId,
    toolDecisions,
    toolOutputs,
    trigger: parsedBody.trigger,
  };
};

// ---------------------------------------------------------------------------
// Stored parts → UI messages
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool plumbing
// ---------------------------------------------------------------------------

const assertCanUseAiCredits = async (input: {
  organizationId: string;
  userId: string;
}) => {
  try {
    await assertAiChatCredits({
      organizationId: input.organizationId,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      throw new ChatRequestError(error.status, error.message, { cause: error });
    }
    throw error;
  }
};

const runMailTool = async <T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
) => {
  const timeoutSignal = AbortSignal.timeout(MAIL_TOOL_TIMEOUT_MS);
  const combined =
    signal === undefined
      ? timeoutSignal
      : AbortSignal.any([signal, timeoutSignal]);
  try {
    return await operation(combined);
  } catch (error) {
    if (signal?.aborted !== true && timeoutSignal.aborted) {
      throw new Error(
        "The mail lookup timed out. Retry with a narrower search.",
        { cause: error }
      );
    }
    throw error;
  }
};

const buildMailboxContextPrompt = (context: {
  messageId?: string;
  query?: string;
  threadId?: string;
}) => {
  const entries = [
    context.messageId === undefined
      ? null
      : `Selected message id: ${context.messageId}`,
    context.threadId === undefined
      ? null
      : `Selected thread id: ${context.threadId}`,
    context.query === undefined
      ? null
      : `Open mailbox search: ${context.query}`,
  ].filter((entry): entry is string => entry !== null);
  if (entries.length === 0) {
    return null;
  }
  return `The user opened chat from this mailbox context:\n${entries
    .map((entry) => `- ${entry}`)
    .join(
      "\n"
    )}\nTreat these identifiers only as navigation hints. Retrieve live data before answering about them.`;
};

const createGmailToolsContext = (input: {
  category: MailboxCategory;
  mailboxId: string;
  userId: string;
}): GmailToolsContext => ({
  category: input.category,
  getMailboxOverview: async (signal) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await getMailboxOverviewForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  listGmailLabels: async (signal) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await listGmailLabelsForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  modifyMail: async ({ action, id, signal, target }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await modifyMailForUser({
          action,
          category: input.category,
          id,
          mailboxId: input.mailboxId,
          signal: runSignal,
          target,
          userId: input.userId,
        })
    ),
  readGmailAttachment: async ({ attachmentId, messageId, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailAttachmentForUser({
          attachmentId,
          category: input.category,
          mailboxId: input.mailboxId,
          messageId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  readGmailMessage: async ({ messageId, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailMessageForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          messageId,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  readGmailMessages: async ({ messageIds, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailMessagesForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          messageIds,
          signal: runSignal,
          userId: input.userId,
        })
    ),
  readGmailThread: async ({ signal, threadId }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await readGmailThreadForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          signal: runSignal,
          threadId,
          userId: input.userId,
        })
    ),
  searchGmail: async ({ maxResults, pageToken, query, signal }) =>
    await runMailTool(
      signal,
      async (runSignal) =>
        await searchGmailForUser({
          category: input.category,
          mailboxId: input.mailboxId,
          maxResults,
          pageToken,
          query,
          signal: runSignal,
          userId: input.userId,
        })
    ),
});

const getLatestUserRequest = (transcript: readonly UIMessage[]) =>
  transcript
    .findLast((message) => message.role === "user")
    ?.parts.flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : []
    )
    .join(" ")
    .slice(0, 4000) ?? "";

const createMemoryToolContext = (input: {
  latestUserRequest: string;
  mailboxId: string;
  userId: string;
}): AiMemoryToolsContext => ({
  useMemory: async ({ request, scope }) => {
    if (input.latestUserRequest.trim() === "") {
      return { status: "skipped" };
    }
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    });
    const requestedScopes =
      scope === "both"
        ? (["user", "mailbox"] as const)
        : ([scope === "personal" ? "user" : "mailbox"] as const);
    const answers = await Promise.all(
      requestedScopes.map(async (requestedScope) => {
        const canMutate =
          scope !== "both" &&
          (requestedScope === "user" ||
            selectedMailbox.capabilities.canManageKnowledge);
        const result = await requestAiMemoryUpdate({
          allowMutations: canMutate,
          changeSetSource: "chat",
          mailboxId: input.mailboxId,
          request,
          scope: requestedScope,
          userId: input.userId,
          userMessage: input.latestUserRequest,
        });
        return {
          answer: result.answer,
          changed: result.status === "applied",
          scope: requestedScope,
        };
      })
    );
    return {
      answer: answers
        .map(({ answer, scope: answerScope }) =>
          answers.length === 1
            ? answer
            : `${answerScope === "user" ? "Personal" : "This mailbox"}: ${answer}`
        )
        .join("\n\n"),
      status: answers.some(({ changed }) => changed)
        ? ("updated" as const)
        : ("answered" as const),
    };
  },
});

// ---------------------------------------------------------------------------
// Approvals and client resolutions
// ---------------------------------------------------------------------------

const isPendingToolPart = (part: unknown): boolean => {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const type: unknown = Reflect.get(part, "type");
  if (typeof type !== "string" || !type.startsWith("tool-")) {
    return false;
  }
  const toolCallId: unknown = Reflect.get(part, "toolCallId");
  if (typeof toolCallId !== "string") {
    return false;
  }
  const state: unknown = Reflect.get(part, "state");
  return state === "approval-requested" || state === "input-available";
};

const readStoredApprovalId = (part: object): string | null => {
  const approval: unknown = Reflect.get(part, "approval");
  if (typeof approval !== "object" || approval === null) {
    return null;
  }
  const id: unknown = Reflect.get(approval, "id");
  return typeof id === "string" && id !== "" ? id : null;
};

/**
 * Applies the client's approval decisions and compose outcomes onto the
 * stored assistant message. The database stays the source of truth; the
 * client only contributes which pending item resolved and how.
 */
const applyClientResolutions = (
  message: UIMessage,
  resolutions: {
    toolDecisions: Map<string, boolean>;
    toolOutputs: Map<string, unknown>;
  }
) => ({
  ...message,
  parts: message.parts.map((part): UIMessagePart => {
    const type: unknown = Reflect.get(part, "type");
    if (typeof type !== "string" || !type.startsWith("tool-")) {
      return part;
    }
    const toolCallId: unknown = Reflect.get(part, "toolCallId");
    if (typeof toolCallId !== "string") {
      return part;
    }
    const state: unknown = Reflect.get(part, "state");
    const decision = resolutions.toolDecisions.get(toolCallId);
    if (decision !== undefined && state === "approval-requested") {
      const approvalId = readStoredApprovalId(part);
      if (approvalId === null) {
        // Pending ids are validated before the turn continues; this guard
        // only satisfies the type.
        return part;
      }
      // Part unions make this override awkward to express directly.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ...part,
        approval: {
          approved: decision,
          id: approvalId,
        },
        state: "approval-responded",
      } as unknown as UIMessagePart;
    }
    if (
      resolutions.toolOutputs.has(toolCallId) &&
      state === "input-available"
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ...part,
        output: resolutions.toolOutputs.get(toolCallId),
        state: "output-available",
      } as unknown as UIMessagePart;
    }
    return part;
  }),
});

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const loadRecentRows = async (chatId: string) => {
  const rows = await db
    .select({
      createdAt: chatMessage.createdAt,
      id: chatMessage.id,
      parts: chatMessage.parts,
      position: chatMessage.position,
      role: chatMessage.role,
    })
    .from(chatMessage)
    .where(eq(chatMessage.chatId, chatId))
    .orderBy(desc(chatMessage.position))
    .limit(CHAT_HISTORY_WINDOW_MESSAGES);
  return rows.toReversed();
};

const getStoredMessageText = (parts: ChatMessagePart[]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : []
    )
    .join("");

const generateChatTitleInBackground = (input: {
  chatId: string;
  fallbackTitle: string;
  mailboxId: string;
  prompt: string;
  userId: string;
}) => {
  void (async () => {
    try {
      const { generateChatTitle } =
        await import("@quieter/ai/generate-chat-title");
      const title = await generateChatTitle({
        onUsage: (usage) => {
          void reportAiUsage({
            chatId: input.chatId,
            completionTokens: usage.completionTokens,
            costUsd: usage.costUsd,
            externalId: `chat-title:${input.chatId}`,
            mailboxId: input.mailboxId,
            model: CHAT_TITLE_MODEL,
            promptTokens: usage.promptTokens,
            promptTokensDetails: {
              cacheWriteTokens: usage.cacheWriteTokens,
              cachedTokens: usage.cachedTokens,
            },
            usageKind: "aiChat",
            userId: input.userId,
          }).catch((error: unknown) => {
            reportError(error, { operation: "chat:report-title-usage" });
          });
        },
        prompt: input.prompt,
      });
      if (title === "") {
        return;
      }
      // Only replace the fallback while the user has not renamed the chat.
      await db
        .update(chatTable)
        .set({ title })
        .where(
          and(
            eq(chatTable.id, input.chatId),
            eq(chatTable.title, input.fallbackTitle),
            eq(chatTable.userId, input.userId)
          )
        );
    } catch (error: unknown) {
      reportError(error, { operation: "chat:generate-title" });
    }
  })();
};

const prepareChatContext = async (input: {
  context: { messageId?: string; query?: string; threadId?: string };
  mailboxId: string;
  userId: string;
  memoryQuery: string;
}) => {
  const aiContext = await loadAiAgentContext({
    agent: "chat",
    mailboxId: input.mailboxId,
    query: input.memoryQuery,
    userId: input.userId,
  });
  return {
    mailboxContextPrompt: buildMailboxContextPrompt(input.context),
    serializedAiContext: serializeAiAgentContext(aiContext),
  };
};

// The request coordinates authorization, persistence, tool availability, and
// streaming in one boundary.
export const createAiChatResponse = async (input: {
  body: unknown;
  request: Request;
  userId: string;
}) => {
  let validated: ValidatedChatRequest;
  try {
    validated = validateChatRequest(input.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ChatRequestError(400, "Invalid chat request.", {
        cause: error,
      });
    }
    throw error;
  }
  const { mailboxId, threadId } = validated;
  let accessibleMailbox: Awaited<ReturnType<typeof assertAccessibleMailbox>>;
  try {
    accessibleMailbox = await assertAccessibleMailbox({
      mailboxId,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      throw new ChatRequestError(404, "Mailbox not found.", { cause: error });
    }
    throw error;
  }
  if (accessibleMailbox.provider !== "gmail") {
    throw new ChatRequestError(400, "AI chat supports Gmail mailboxes only.");
  }
  await assertCanUseAiCredits({
    organizationId: accessibleMailbox.organizationId,
    userId: input.userId,
  });

  const rows = await loadRecentRows(threadId);
  const lastRow = rows.at(-1);
  let transcript: UIMessage[];
  let assistantMessageId: string;
  let assistantPosition: number;
  let continuingRowId: string | null = null;
  let createdChat = false;

  if (validated.kind === "message") {
    const [existingChat] = await db
      .select({
        id: chatTable.id,
        mailboxId: chatTable.mailboxId,
        title: chatTable.title,
        userId: chatTable.userId,
      })
      .from(chatTable)
      .where(eq(chatTable.id, threadId))
      .limit(1);
    if (
      existingChat !== undefined &&
      (existingChat.mailboxId !== mailboxId ||
        existingChat.userId !== input.userId)
    ) {
      throw new ChatRequestError(404, "Chat not found.");
    }

    const userParts: ChatMessagePart[] = [
      { text: validated.userMessage.text, type: "text" },
    ];
    if (
      lastRow?.role === "user" &&
      lastRow.id === validated.userMessage.id &&
      getStoredMessageText(lastRow.parts) === validated.userMessage.text
    ) {
      // The previous attempt was aborted before its answer was persisted;
      // reuse the stored user message instead of duplicating it.
      transcript = toCanonicalTranscript(rows);
      assistantPosition = lastRow.position + 1;
    } else {
      if (lastRow?.role === "user") {
        throw new ChatRequestError(
          409,
          "The previous chat turn is incomplete. Retry it before sending another message."
        );
      }
      const [duplicate] = await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.id, validated.userMessage.id))
        .limit(1);
      if (duplicate !== undefined) {
        throw new ChatRequestError(
          409,
          "This chat message has already been submitted."
        );
      }
      const now = new Date();
      if (existingChat === undefined) {
        createdChat = true;
        await db.insert(chatTable).values({
          createdAt: now,
          id: threadId,
          mailboxId,
          title: createChatTitle(validated.userMessage.text),
          updatedAt: now,
          userId: input.userId,
        });
      }
      const userPosition = (lastRow?.position ?? -1) + 1;
      await db.insert(chatMessage).values({
        chatId: threadId,
        createdAt: now,
        id: validated.userMessage.id,
        parts: userParts,
        position: userPosition,
        role: "user",
        userId: input.userId,
      });
      transcript = [
        ...toCanonicalTranscript(rows),
        {
          id: validated.userMessage.id,
          parts: [{ text: validated.userMessage.text, type: "text" }],
          role: "user",
        } satisfies UIMessage,
      ];
      assistantPosition = userPosition + 1;
    }
    assistantMessageId = crypto.randomUUID();
    if (createdChat) {
      generateChatTitleInBackground({
        chatId: threadId,
        fallbackTitle: createChatTitle(validated.userMessage.text),
        mailboxId,
        prompt: validated.userMessage.text,
        userId: input.userId,
      });
    }
  } else if (validated.kind === "continue") {
    if (lastRow === undefined || lastRow.role !== "assistant") {
      throw new ChatRequestError(
        409,
        "This answer is no longer waiting for a response."
      );
    }
    for (const part of lastRow.parts) {
      if (
        Reflect.get(part, "state") === "approval-requested" &&
        readStoredApprovalId(part) === null
      ) {
        throw new ChatRequestError(
          409,
          "This answer is no longer waiting for a response."
        );
      }
    }
    const pendingIds = new Set(
      lastRow.parts
        .filter(isPendingToolPart)
        .map((part) => String(Reflect.get(part, "toolCallId")))
    );
    const resolvesSomething =
      [...validated.toolDecisions.keys()].some((toolCallId) =>
        pendingIds.has(toolCallId)
      ) ||
      [...validated.toolOutputs.keys()].some((toolCallId) =>
        pendingIds.has(toolCallId)
      );
    if (!resolvesSomething) {
      throw new ChatRequestError(
        409,
        "This answer is no longer waiting for a response."
      );
    }
    const storedMessage: UIMessage = {
      id: lastRow.id,
      // Parts round-trip as opaque JSON; the resolutions above re-validate
      // everything the model consumes.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      parts: lastRow.parts as UIMessagePart[],
      role: "assistant",
    };
    transcript = [
      ...toCanonicalTranscript(rows.slice(0, -1)),
      applyClientResolutions(storedMessage, validated),
    ];
    assistantMessageId = lastRow.id;
    assistantPosition = lastRow.position;
    continuingRowId = lastRow.id;
  } else {
    if (lastRow === undefined) {
      throw new ChatRequestError(409, "There is no answer to retry yet.");
    }
    const trailingAssistantIds: string[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.role !== "assistant") {
        break;
      }
      if (row.id !== undefined) {
        trailingAssistantIds.push(row.id);
      }
    }
    if (trailingAssistantIds.length > 0) {
      await db
        .delete(chatMessage)
        .where(inArray(chatMessage.id, trailingAssistantIds));
      rows.splice(rows.length - trailingAssistantIds.length);
    }
    const lastRemaining = rows.at(-1);
    if (lastRemaining?.role !== "user") {
      throw new ChatRequestError(409, "There is no answer to retry yet.");
    }
    transcript = toCanonicalTranscript(rows);
    assistantPosition = lastRemaining.position + 1;
    assistantMessageId = crypto.randomUUID();
  }

  const latestUserRequest = getLatestUserRequest(transcript);
  const preparedContext = await prepareChatContext({
    context: validated.context ?? {},
    mailboxId,
    memoryQuery: transcript
      .filter((message) => message.role === "user")
      .slice(-3)
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && typeof part.text === "string"
            ? [part.text]
            : []
        )
      )
      .join(" ")
      .slice(0, 4000),
    userId: input.userId,
  });

  const checkConnector = async (
    provider: typeof GOOGLE_CALENDAR_CONNECTOR_PROVIDER
  ) => {
    try {
      return await hasConnectedConnector({ provider, userId: input.userId });
    } catch (error) {
      reportError(error, { operation: `chat:inspect-${provider}-connector` });
      return false;
    }
  };
  const hasGoogleCalendarConnector = await checkConnector(
    GOOGLE_CALENDAR_CONNECTOR_PROVIDER
  );

  const tools = {
    ...createGmailChatTools(
      createGmailToolsContext({
        category: validated.category,
        mailboxId,
        userId: input.userId,
      })
    ),
    ...createComposeEmailChatTool(),
    ...createAiMemoryChatTool(
      createMemoryToolContext({
        latestUserRequest,
        mailboxId,
        userId: input.userId,
      })
    ),
    ...createLinearChatTools({
      latestUserRequest,
      userId: input.userId,
    }),
    ...(hasGoogleCalendarConnector
      ? createGoogleCalendarChatTool({
          createGoogleCalendarEvent: async (event, signal) =>
            await createGoogleCalendarEventForUser({
              event,
              signal,
              userId: input.userId,
            }),
        })
      : {}),
  };

  const systemPrompt = [
    gmailToolsPrompt,
    ...(preparedContext.mailboxContextPrompt === null
      ? []
      : [preparedContext.mailboxContextPrompt]),
    ...(preparedContext.serializedAiContext === null
      ? []
      : [
          `The following user-authored instructions and learned memory were loaded through Quieter's authorized AI context. Follow them unless they conflict with the current request, safety rules, or verified mailbox data.\n\n${preparedContext.serializedAiContext}`,
        ]),
    ...(hasGoogleCalendarConnector ? [googleCalendarToolsPrompt] : []),
    linearToolsPrompt,
  ].join("\n\n");

  const usageId = crypto.randomUUID();
  let generationFailed = false;
  const modelMessages = await convertToModelMessages(transcript);
  const result = streamText({
    abortSignal: input.request.signal,
    instructions: systemPrompt,
    maxOutputTokens: CHAT_MAX_COMPLETION_TOKENS,
    messages: modelMessages,
    model: createChatModel(validated.model),
    onEnd: ({ steps }) => {
      const usage = summarizeAiUsage({ steps });
      void (async () => {
        try {
          await reportAiUsage({
            chatId: threadId,
            completionTokens: usage.completionTokens,
            costUsd: usage.costUsd,
            externalId: `${usageId}:${assistantMessageId}`,
            mailboxId,
            model: validated.model,
            promptTokens: usage.promptTokens,
            promptTokensDetails: {
              cacheWriteTokens: usage.cacheWriteTokens,
              cachedTokens: usage.cachedTokens,
            },
            usageKind: "aiChat",
            userId: input.userId,
          });
        } catch (error: unknown) {
          reportError(error, { operation: "chat:report-ai-usage" });
        }
      })();
    },
    onError: ({ error }) => {
      generationFailed = true;
      reportError(error, { operation: "chat:generation" });
    },
    providerOptions: {
      openrouter: {
        reasoning: {
          effort: "medium",
        },
      },
    },
    // The SDK defaults to a single step, which would end the turn right
    // after the first tool round; the model may chain tools for as long as
    // the request stays open.
    stopWhen: isStepCount(Number.MAX_SAFE_INTEGER),
    toolApproval: {
      ...(hasGoogleCalendarConnector
        ? { create_google_calendar_event: "user-approval" as const }
        : {}),
      linear_write: "user-approval" as const,
      memory: "user-approval" as const,
      modify_mail: "user-approval" as const,
    },
    tools,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      generateMessageId: () => assistantMessageId,
      onEnd: async ({ messages }) => {
        // Stopping keeps whatever was generated so far; only a failed
        // generation leaves nothing behind, since its partial output cannot
        // be told apart from a broken answer.
        if (generationFailed) {
          return;
        }
        const responseMessage = messages.at(-1);
        if (responseMessage?.role !== "assistant") {
          return;
        }
        const hasContent = responseMessage.parts.some(
          (part) => part.type !== "step-start"
        );
        if (!hasContent) {
          return;
        }
        try {
          const now = new Date();
          const parts = responseMessage.parts as ChatMessagePart[];
          if (continuingRowId === null) {
            await db.insert(chatMessage).values({
              chatId: threadId,
              createdAt: now,
              id: assistantMessageId,
              parts,
              position: assistantPosition,
              role: "assistant",
              userId: input.userId,
            });
          } else {
            await db
              .update(chatMessage)
              .set({ parts })
              .where(
                and(
                  eq(chatMessage.id, continuingRowId),
                  eq(chatMessage.chatId, threadId)
                )
              );
          }
          await db
            .update(chatTable)
            .set({ updatedAt: now })
            .where(eq(chatTable.id, threadId));
        } catch (error) {
          reportError(error, { operation: "chat:persist-assistant-turn" });
        }
      },
      onError: () => "The answer could not be completed.",
      originalMessages: transcript,
      stream: result.stream,
    }),
  });
};
