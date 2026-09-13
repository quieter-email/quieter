import { ORPCError } from "@orpc/server";
import {
  createAiMemoryChatTool,
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
import { chatModelSchema } from "@quieter/ai/chat-models";
import {
  createForegroundClientTools,
  createForegroundServerTools,
  editComposeOutputSchema,
  foregroundComposeDraftSchema,
  foregroundSnapshotSchema,
  getWorkspaceOutputSchema,
  isForegroundClientToolName,
  navigateOutputSchema,
  openComposeOutputSchema,
  saveComposeDraftOutputSchema,
  sendMailOutputSchema,
} from "@quieter/ai/chat-tools";
import type { ForegroundSnapshot } from "@quieter/ai/chat-tools";
import { toCanonicalTranscript } from "@quieter/ai/chat-transcript";
import { summarizeAiUsage } from "@quieter/ai/chat-usage";
import { isTransientAiProviderError } from "@quieter/ai/errors";
import { generateChatTitle } from "@quieter/ai/generate-chat-title";
import {
  resolveBackgroundModel,
  resolveChatModel,
} from "@quieter/ai/model-config";
import { createChatModel } from "@quieter/ai/openrouter";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { chat as chatTable, chatMessage } from "@quieter/database/schema";
import type { ChatMessagePart } from "@quieter/database/schema";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import type { MailboxCategory } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  isToolUIPart,
  streamText,
  toUIMessageStream,
} from "ai";
import type { TextStreamPart, UIMessage, UIMessageChunk } from "ai";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { assertCanUseAi } from "../ai-access";
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
import { composeMailOperations } from "../mail/compose";
import { assertAccessibleMailbox } from "../mailbox/service";
import { replaceChatParts } from "./continuation";
import { createLinearChatTools } from "./linear-tools";

type UIMessagePart = UIMessage["parts"][number];

const CHAT_HISTORY_WINDOW_MESSAGES = 30;
const CHAT_MAX_COMPLETION_TOKENS = 2048;
const CHAT_MAX_STEPS = 6;
const MAIL_TOOL_TIMEOUT_MS = 25_000;
const FOREGROUND_EXCHANGE_MAX_MS = 5 * 60_000;

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

/**
 * Maps a stream failure onto the user-facing error text sent as the UI
 * message stream's error chunk. Distinct texts keep Sentry issues and user
 * reports attributable to provider throttling, client disconnects, stale
 * foreground exchanges, and genuine generation failures.
 */
export const resolveChatStreamErrorMessage = (error: unknown): string => {
  if (error instanceof ChatRequestError) {
    return "This chat changed while the answer was being completed. Retry it.";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "The request was stopped.";
  }
  return isTransientAiProviderError(error)
    ? "The assistant is busy. Retry shortly."
    : "The answer could not be completed.";
};

/**
 * Maps request validation failures onto the user-facing response text.
 * Curated custom issues carry actionable wording (expired exchanges, stale
 * workspace results); raw schema violations stay generic so Sentry issues
 * and user reports remain attributable without leaking shapes.
 */
export const resolveChatValidationErrorMessage = (error: z.ZodError): string =>
  error.issues.find(({ code }) => code === "custom")?.message ??
  "Invalid chat request.";

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
  foreground: ForegroundSnapshot;
  mailboxId: string;
  model: z.infer<typeof chatModelSchema>;
  threadId: string;
  trigger: "submit-message";
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
  );

const chatRequestBodySchema = z
  .object({
    category: mailCategorySchema,
    context: contextSchema.optional(),
    foreground: foregroundSnapshotSchema,
    mailboxId: identifierSchema,
    message: z.unknown(),
    model: chatModelSchema.optional(),
    threadId: z.uuid(),
    trigger: z.literal("submit-message"),
  })
  .strict();

export const validateChatRequest = (body: unknown): ValidatedChatRequest => {
  const parsedBody = chatRequestBodySchema.parse(body);
  const { threadId } = parsedBody;
  const now = Date.now();
  if (
    parsedBody.foreground.expiresAt <= now ||
    parsedBody.foreground.expiresAt > now + FOREGROUND_EXCHANGE_MAX_MS
  ) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "The foreground exchange has expired.",
        path: ["foreground", "expiresAt"],
      },
    ]);
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
      foreground: parsedBody.foreground,
      kind: "message",
      mailboxId: parsedBody.mailboxId,
      model: parsedBody.model ?? resolveChatModel(),
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
      const toolName = type.slice("tool-".length);
      if (!isForegroundClientToolName(toolName)) {
        throw new z.ZodError([
          {
            code: "custom",
            message: "This tool result cannot be supplied by the client.",
            path: ["message", "parts"],
          },
        ]);
      }
      const outputSchema = {
        edit_compose: editComposeOutputSchema,
        get_workspace: getWorkspaceOutputSchema,
        navigate: navigateOutputSchema,
        open_compose: openComposeOutputSchema,
      }[toolName];
      const output = outputSchema.parse(part.output);
      if (output.generation !== parsedBody.foreground.generation) {
        throw new z.ZodError([
          {
            code: "custom",
            message: "The client result belongs to an older workspace state.",
            path: ["message", "parts"],
          },
        ]);
      }
      toolOutputs.set(toolPart.toolCallId, output);
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
    foreground: parsedBody.foreground,
    kind: "continue",
    mailboxId: parsedBody.mailboxId,
    model: parsedBody.model ?? resolveChatModel(),
    threadId,
    toolDecisions,
    toolOutputs,
    trigger: parsedBody.trigger,
  };
};

// ---------------------------------------------------------------------------
// Tool plumbing
// ---------------------------------------------------------------------------

const assertCanUseAiCredits = async (input: {
  organizationId: string;
  userId: string;
}) => {
  try {
    await assertCanUseAi({
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

export const toForegroundComposeMessage = (
  draft: z.infer<typeof foregroundComposeDraftSchema>,
  localId: string
) => ({
  attachments: draft.attachments,
  bodyHtml: draft.bodyHtml,
  bodyText: draft.bodyText ?? "",
  draftId: draft.providerDraftId ?? null,
  errorMessage: null,
  inlineImages: draft.inlineImages,
  localId,
  messageId: null,
  recipients: {
    bcc: draft.bcc ?? "",
    cc: draft.cc ?? "",
    to: draft.to ?? "",
  },
  replyContext: draft.replyContext ?? null,
  saveStatus: "saved",
  subject: draft.subject ?? "",
  updatedAt: draft.draftRevision,
});

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

const hasMatchingForegroundLease = (
  part: object,
  foreground: ForegroundSnapshot
) => {
  const stored = foregroundSnapshotSchema.safeParse(
    Reflect.get(part, "foreground")
  );
  if (!stored.success || stored.data.expiresAt <= Date.now()) {
    return false;
  }
  return JSON.stringify(stored.data) === JSON.stringify(foreground);
};

const stampForegroundLease = (
  parts: ChatMessagePart[],
  foreground: ForegroundSnapshot
) =>
  parts.map((part) =>
    typeof part.type === "string" && part.type.startsWith("tool-")
      ? { ...part, foreground }
      : part
  );

const assertForegroundExchangeActive = async (input: {
  assistantMessageId: string;
  chatId: string;
  userId: string;
}) => {
  const [messageRows, userRows] = await Promise.all([
    db
      .select({ parts: chatMessage.parts })
      .from(chatMessage)
      .where(
        and(
          eq(chatMessage.id, input.assistantMessageId),
          eq(chatMessage.chatId, input.chatId),
          eq(chatMessage.userId, input.userId)
        )
      )
      .limit(1),
    db
      .select({ parts: chatMessage.parts })
      .from(chatMessage)
      .where(
        and(
          eq(chatMessage.chatId, input.chatId),
          eq(chatMessage.userId, input.userId),
          eq(chatMessage.role, "user")
        )
      )
      .orderBy(desc(chatMessage.position))
      .limit(1),
  ]);
  const message = messageRows.at(0);
  const lastUserMessage = userRows.at(0);
  if (
    message?.parts.some((part) => part.type === "data-foreground-cancelled") ===
    true
  ) {
    throw new ChatRequestError(409, "This workspace action was cancelled.");
  }
  const foreground = foregroundSnapshotSchema.safeParse(
    [...(message?.parts ?? []), ...(lastUserMessage?.parts ?? [])].find(
      (part) =>
        typeof part.foreground === "object" &&
        part.foreground !== null &&
        "exchangeId" in part.foreground &&
        part.foreground.exchangeId === input.assistantMessageId
    )?.foreground
  );
  if (!foreground.success || foreground.data.expiresAt <= Date.now()) {
    throw new ChatRequestError(
      409,
      "This workspace action has expired. Start again from the current mailbox."
    );
  }
};

export const resolveForegroundComposeDraftForPersistence = (input: {
  draft: z.infer<typeof foregroundComposeDraftSchema>;
  foreground: ForegroundSnapshot;
  mailboxId: string;
  transcript: readonly UIMessage[];
}): z.infer<typeof foregroundComposeDraftSchema> => {
  const assistantMessage = input.transcript.findLast(
    (message) =>
      message.id === input.foreground.exchangeId && message.role === "assistant"
  );
  let workspaceDraft: z.infer<typeof foregroundComposeDraftSchema> | undefined;
  if (assistantMessage !== undefined) {
    for (
      let index = assistantMessage.parts.length - 1;
      index >= 0;
      index -= 1
    ) {
      const part = assistantMessage.parts[index];
      if (
        part === undefined ||
        !isToolUIPart(part) ||
        part.type !== "tool-get_workspace" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const workspace = getWorkspaceOutputSchema.safeParse(part.output);
      if (
        workspace.success &&
        workspace.data.generation === input.foreground.generation &&
        workspace.data.mailboxId === input.mailboxId
      ) {
        workspaceDraft = workspace.data.draft;
      }
      break;
    }
  }

  if (workspaceDraft === undefined) {
    throw new ChatRequestError(
      409,
      "Read the visible draft again before saving or sending it."
    );
  }
  if (
    JSON.stringify(foregroundComposeDraftSchema.parse(input.draft)) !==
    JSON.stringify(workspaceDraft)
  ) {
    throw new ChatRequestError(
      409,
      "The visible draft changed. Read it again before saving or sending it."
    );
  }
  if (
    workspaceDraft.attachments.length > 0 ||
    workspaceDraft.inlineImages.length > 0
  ) {
    throw new ChatRequestError(
      409,
      "This draft has attachments. Save or send it from the composer."
    );
  }

  return workspaceDraft;
};

/**
 * Applies the client's approval decisions and workspace command outcomes onto the
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
    if (!isToolUIPart(part)) {
      return part;
    }
    const decision = resolutions.toolDecisions.get(part.toolCallId);
    if (decision !== undefined && part.state === "approval-requested") {
      return {
        ...part,
        approval: {
          approved: decision,
          id: part.approval.id,
        },
        state: "approval-responded",
      };
    }
    if (
      resolutions.toolOutputs.has(part.toolCallId) &&
      part.state === "input-available"
    ) {
      return {
        ...part,
        output: resolutions.toolOutputs.get(part.toolCallId),
        state: "output-available",
      };
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

const generateChatTitleInRequest = async (input: {
  chatId: string;
  fallbackTitle: string;
  mailboxId: string;
  prompt: string;
  userId: string;
}) => {
  try {
    const titleModel = resolveBackgroundModel();
    const title = await generateChatTitle({
      onUsage: (usage) => {
        void reportAiUsage({
          chatId: input.chatId,
          completionTokens: usage.completionTokens,
          costUsd: usage.costUsd,
          externalId: `chat-title:${input.chatId}`,
          mailboxId: input.mailboxId,
          model: titleModel,
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
      throw new ChatRequestError(
        400,
        resolveChatValidationErrorMessage(error),
        {
          cause: error,
        }
      );
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
  if (validated.kind !== "message" && existingChat === undefined) {
    throw new ChatRequestError(404, "Chat not found.");
  }

  const rows = await loadRecentRows(threadId);
  if (
    rows.some(
      (row) =>
        row.id === validated.foreground.exchangeId &&
        row.parts.some((part) => part.type === "data-foreground-cancelled")
    )
  ) {
    throw new ChatRequestError(409, "This workspace action was cancelled.");
  }
  const lastRow = rows.at(-1);
  let transcript: UIMessage[];
  let assistantMessageId: string;
  let assistantReservationParts: ChatMessagePart[] | null = null;
  let continuingRowId: string | null = null;
  let continuingOriginalParts: ChatMessagePart[] | null = null;
  let shouldGenerateTitle = false;

  if (validated.kind === "message") {
    assistantMessageId = validated.foreground.exchangeId;
    const reservationParts: ChatMessagePart[] = [
      { foreground: validated.foreground, type: "data-foreground" },
    ];
    assistantReservationParts = reservationParts;
    const userParts: ChatMessagePart[] = [
      { text: validated.userMessage.text, type: "text" },
      { foreground: validated.foreground, type: "data-foreground" },
    ];
    // A failed attempt leaves its user message plus an empty assistant
    // reservation behind. Drop the reservation so an explicit retry reuses
    // the stored user message instead of being rejected as a duplicate.
    const staleReservation = rows.at(-1);
    if (
      staleReservation?.role === "assistant" &&
      staleReservation.parts.length === 1 &&
      staleReservation.parts[0]?.type === "data-foreground"
    ) {
      const [deleted] = await db
        .delete(chatMessage)
        .where(
          and(
            eq(chatMessage.id, staleReservation.id),
            eq(chatMessage.chatId, threadId),
            eq(chatMessage.userId, input.userId),
            eq(chatMessage.parts, staleReservation.parts)
          )
        )
        .returning({ id: chatMessage.id });
      if (deleted !== undefined) {
        rows.pop();
      }
    }
    const previousRow = rows.at(-1);
    if (
      previousRow?.role === "user" &&
      previousRow.id === validated.userMessage.id &&
      getStoredMessageText(previousRow.parts) === validated.userMessage.text
    ) {
      // The previous attempt was aborted before its answer was persisted;
      // reuse the stored user message instead of duplicating it.
      transcript = toCanonicalTranscript(rows);
      const [reserved] = await db
        .insert(chatMessage)
        .values({
          chatId: threadId,
          createdAt: new Date(),
          id: assistantMessageId,
          parts: reservationParts,
          position: previousRow.position + 1,
          role: "assistant",
          userId: input.userId,
        })
        .onConflictDoNothing()
        .returning({ id: chatMessage.id });
      if (reserved === undefined) {
        throw new ChatRequestError(
          409,
          "This chat exchange has already been submitted."
        );
      }
    } else {
      if (previousRow?.role === "user") {
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
      shouldGenerateTitle = !rows.some((row) => row.role === "user");
      const userPosition = (lastRow?.position ?? -1) + 1;
      try {
        await db.transaction(async (transaction) => {
          if (existingChat === undefined) {
            await transaction.insert(chatTable).values({
              createdAt: now,
              id: threadId,
              mailboxId,
              title: createChatTitle(validated.userMessage.text),
              updatedAt: now,
              userId: input.userId,
            });
          } else if (shouldGenerateTitle) {
            await transaction
              .update(chatTable)
              .set({ title: createChatTitle(validated.userMessage.text) })
              .where(
                and(
                  eq(chatTable.id, threadId),
                  isNull(chatTable.title),
                  eq(chatTable.userId, input.userId)
                )
              );
          }
          await transaction.insert(chatMessage).values({
            chatId: threadId,
            createdAt: now,
            id: validated.userMessage.id,
            parts: userParts,
            position: userPosition,
            role: "user",
            userId: input.userId,
          });
          await transaction.insert(chatMessage).values({
            chatId: threadId,
            createdAt: now,
            id: assistantMessageId,
            parts: reservationParts,
            position: userPosition + 1,
            role: "assistant",
            userId: input.userId,
          });
        });
      } catch (error) {
        let errorCode: unknown;
        if (error !== null && typeof error === "object") {
          errorCode = Reflect.get(error, "code");
          if (errorCode === undefined) {
            const cause: unknown = Reflect.get(error, "cause");
            if (cause !== null && typeof cause === "object") {
              errorCode = Reflect.get(cause, "code");
            }
          }
        }
        if (errorCode === "23505") {
          throw new ChatRequestError(
            409,
            "This chat changed while your message was sending. Retry it.",
            { cause: error }
          );
        }
        throw error;
      }
      transcript = [
        ...toCanonicalTranscript(rows),
        {
          id: validated.userMessage.id,
          parts: [{ text: validated.userMessage.text, type: "text" }],
          role: "user",
        } satisfies UIMessage,
      ];
    }
  } else if (validated.kind === "continue") {
    if (
      lastRow === undefined ||
      lastRow.role !== "assistant" ||
      lastRow.id !== validated.assistantMessageId
    ) {
      throw new ChatRequestError(
        409,
        "This answer is no longer waiting for a response."
      );
    }
    if (lastRow.parts.some((part) => part.state === "approval-responded")) {
      throw new ChatRequestError(
        409,
        "An action was already submitted. Wait for its result, or check the affected item and send a new message."
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
    const resolvedIds = new Set([
      ...validated.toolDecisions.keys(),
      ...validated.toolOutputs.keys(),
    ]);
    if (
      lastRow.parts.some(
        (part) =>
          resolvedIds.has(String(Reflect.get(part, "toolCallId"))) &&
          !hasMatchingForegroundLease(part, validated.foreground)
      )
    ) {
      throw new ChatRequestError(
        409,
        "This workspace action is no longer active. Start again from the current mailbox."
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
    continuingRowId = lastRow.id;
    continuingOriginalParts = lastRow.parts;
  } else {
    throw new ChatRequestError(400, "Invalid chat request.");
  }

  const latestUserRequest = getLatestUserRequest(transcript);
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
  const memoryQuery = transcript
    .filter((message) => message.role === "user")
    .slice(-3)
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : []
      )
    )
    .join(" ")
    .slice(0, 4000);
  const [preparedContext, hasGoogleCalendarConnector, modelMessages] =
    await Promise.all([
      prepareChatContext({
        context: validated.context ?? {},
        mailboxId,
        memoryQuery,
        userId: input.userId,
      }),
      checkConnector(GOOGLE_CALENDAR_CONNECTOR_PROVIDER),
      convertToModelMessages(transcript),
    ]);
  const gmailToolsContext = createGmailToolsContext({
    category: validated.category,
    mailboxId,
    userId: input.userId,
  });

  const tools = {
    ...createForegroundClientTools(),
    ...createForegroundServerTools({
      saveComposeDraft: async ({ draft, toolCallId }, signal) => {
        await assertForegroundExchangeActive({
          assistantMessageId,
          chatId: threadId,
          userId: input.userId,
        });
        const reviewedDraft = resolveForegroundComposeDraftForPersistence({
          draft,
          foreground: validated.foreground,
          mailboxId,
          transcript,
        });
        const saved = await runMailTool(
          signal,
          async (runSignal) =>
            await composeMailOperations.saveDraft({
              context: { signal: runSignal, userId: input.userId },
              input: {
                draft: toForegroundComposeMessage(
                  reviewedDraft,
                  `chat:${threadId}:${assistantMessageId}:${toolCallId}`
                ),
                mailboxId,
              },
            })
        );
        return saveComposeDraftOutputSchema.parse({
          draftId: draft.draftId,
          draftRevision: draft.draftRevision,
          ...(saved.messageId === undefined
            ? {}
            : { messageId: saved.messageId }),
          providerDraftId: saved.draftId,
          status: "draft_saved" as const,
        });
      },
      sendMail: async ({ draft, toolCallId }, signal) => {
        await assertForegroundExchangeActive({
          assistantMessageId,
          chatId: threadId,
          userId: input.userId,
        });
        const reviewedDraft = resolveForegroundComposeDraftForPersistence({
          draft,
          foreground: validated.foreground,
          mailboxId,
          transcript,
        });
        const sent = await runMailTool(
          signal,
          async (runSignal) =>
            await composeMailOperations.sendMessage({
              context: { signal: runSignal, userId: input.userId },
              input: {
                mailboxId,
                message: toForegroundComposeMessage(
                  reviewedDraft,
                  `chat:${threadId}:${assistantMessageId}:${toolCallId}`
                ),
              },
            })
        );
        return sendMailOutputSchema.parse({
          draftId: draft.draftId,
          draftRevision: draft.draftRevision,
          id: sent.id,
          status: "sent" as const,
          ...(sent.threadId === undefined ? {} : { threadId: sent.threadId }),
        });
      },
    }),
    ...createGmailChatTools({
      ...gmailToolsContext,
      modifyMail: async (modifyInput) => {
        await assertForegroundExchangeActive({
          assistantMessageId,
          chatId: threadId,
          userId: input.userId,
        });
        return await gmailToolsContext.modifyMail(modifyInput);
      },
    }),
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
    `The visible workspace is a foreground session. Its selected route and draft are only current for this response. Use get_workspace before relying on a changing selection. Use navigate, open_compose, and edit_compose for visible workspace changes. These tools never save or send mail.`,
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
  const model = createChatModel(validated.model);
  input.request.signal.throwIfAborted();
  if (continuingRowId !== null && continuingOriginalParts !== null) {
    const resolvedParts: ChatMessagePart[] = transcript.at(-1)?.parts ?? [];
    const claimed = await replaceChatParts({
      chatId: threadId,
      expectedParts: continuingOriginalParts,
      messageId: continuingRowId,
      parts: resolvedParts,
      userId: input.userId,
    });
    if (!claimed) {
      throw new ChatRequestError(409, "This action has already been answered.");
    }
    continuingOriginalParts = resolvedParts;
  }
  let generationFailed = false;
  const result = streamText({
    abortSignal: input.request.signal,
    instructions: systemPrompt,
    maxOutputTokens: CHAT_MAX_COMPLETION_TOKENS,
    messages: modelMessages,
    model,
    onEnd: async ({ steps }) => {
      const usage = summarizeAiUsage({ steps });
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
    },
    onError: ({ error }) => {
      generationFailed = true;
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      reportError(error, {
        model: validated.model,
        operation: "chat:generation",
        phase: validated.kind,
        provider: "openrouter",
      });
    },
    providerOptions: {
      openrouter: {
        reasoning: {
          effort: "medium",
        },
      },
    },
    stopWhen: isStepCount(CHAT_MAX_STEPS),
    toolApproval: {
      ...(hasGoogleCalendarConnector
        ? { create_google_calendar_event: "user-approval" as const }
        : {}),
      linear_write: "user-approval" as const,
      memory: "user-approval" as const,
      ...(validated.foreground.policy === "automatic" &&
      validated.foreground.capabilities.includes("modify_mail")
        ? {}
        : { modify_mail: "user-approval" as const }),
      ...(validated.foreground.policy === "automatic" &&
      validated.foreground.capabilities.includes("save_draft")
        ? {}
        : { save_compose_draft: "user-approval" as const }),
      send_mail: "user-approval" as const,
    },
    tools,
  });

  let persistenceErrorText: string | null = null;
  const responseStream = toUIMessageStream({
    generateMessageId: () => assistantMessageId,
    onEnd: async ({ messages }) => {
      // Tool outcomes are already durable; failed prose must not replace them.
      if (generationFailed) {
        return;
      }
      const responseMessage = messages.at(-1);
      if (responseMessage?.role !== "assistant") {
        persistenceErrorText =
          "The answer ended before it produced a response. Retry it.";
        return;
      }
      const hasContent = responseMessage.parts.some(
        (part) => part.type !== "step-start"
      );
      if (!hasContent) {
        persistenceErrorText =
          "The answer ended before it produced a response. Retry it.";
        return;
      }
      try {
        const now = new Date();
        const parts = stampForegroundLease(
          responseMessage.parts,
          validated.foreground
        );
        await db.transaction(async (transaction) => {
          const expectedParts =
            continuingRowId === null
              ? assistantReservationParts
              : continuingOriginalParts;
          if (expectedParts === null) {
            throw new ChatRequestError(409, "This chat exchange is invalid.");
          }
          const [updatedMessage] = await transaction
            .update(chatMessage)
            .set({ parts })
            .where(
              and(
                eq(chatMessage.id, continuingRowId ?? assistantMessageId),
                eq(chatMessage.chatId, threadId),
                eq(chatMessage.userId, input.userId),
                eq(chatMessage.parts, expectedParts)
              )
            )
            .returning({ id: chatMessage.id });
          if (updatedMessage === undefined) {
            throw new ChatRequestError(
              409,
              "This chat changed while the answer was being completed. Retry it."
            );
          }
          await transaction
            .update(chatTable)
            .set({ updatedAt: now })
            .where(
              and(
                eq(chatTable.id, threadId),
                eq(chatTable.mailboxId, mailboxId),
                eq(chatTable.userId, input.userId)
              )
            );
        });
        if (shouldGenerateTitle && validated.kind === "message") {
          await generateChatTitleInRequest({
            chatId: threadId,
            fallbackTitle: createChatTitle(validated.userMessage.text),
            mailboxId,
            prompt: validated.userMessage.text,
            userId: input.userId,
          });
        }
      } catch (error) {
        if (!(error instanceof ChatRequestError)) {
          reportError(error, { operation: "chat:persist-assistant-turn" });
        }
        persistenceErrorText =
          "The answer could not be saved. Retry it before continuing.";
      }
    },
    onError: (error) => {
      if (error instanceof ChatRequestError) {
        reportError(error, { operation: "chat:stream-continuation" });
      } else if (
        !(error instanceof Error && error.name === "AbortError") &&
        !generationFailed
      ) {
        reportError(error, {
          model: validated.model,
          operation: "chat:stream",
          phase: validated.kind,
          provider: "openrouter",
        });
      }
      return resolveChatStreamErrorMessage(error);
    },
    originalMessages: transcript,
    stream: result.stream.pipeThrough(
      new TransformStream<
        TextStreamPart<typeof tools>,
        TextStreamPart<typeof tools>
      >({
        async transform(chunk, controller) {
          if (
            continuingRowId !== null &&
            continuingOriginalParts !== null &&
            (chunk.type === "tool-result" ||
              chunk.type === "tool-error" ||
              chunk.type === "tool-output-denied") &&
            continuingOriginalParts.some(
              (part) => part.toolCallId === chunk.toolCallId
            )
          ) {
            const parts = continuingOriginalParts.map((part) => {
              if (part.toolCallId !== chunk.toolCallId) {
                return part;
              }
              if (chunk.type === "tool-result") {
                const output: unknown = chunk.output;
                return {
                  ...part,
                  output,
                  state: "output-available",
                };
              }
              return chunk.type === "tool-output-denied"
                ? { ...part, state: "output-denied" }
                : {
                    ...part,
                    errorText:
                      "The action could not be confirmed. Check the affected item before trying again.",
                    state: "output-error",
                  };
            });
            const saved = await replaceChatParts({
              chatId: threadId,
              expectedParts: continuingOriginalParts,
              messageId: continuingRowId,
              parts,
              userId: input.userId,
            });
            if (!saved) {
              throw new ChatRequestError(
                409,
                "This chat changed while the action was being saved."
              );
            }
            continuingOriginalParts = parts;
          }
          controller.enqueue(chunk);
        },
      })
    ),
  });
  const durableStream = responseStream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      flush(controller) {
        if (persistenceErrorText !== null) {
          controller.enqueue({
            errorText: persistenceErrorText,
            type: "error",
          });
        }
      },
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    })
  );

  return createUIMessageStreamResponse({
    stream: durableStream,
  });
};
