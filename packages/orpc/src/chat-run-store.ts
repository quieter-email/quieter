import type { ChatModel } from "@quieter/ai";
import {
  chat,
  chatMessage,
  chatRun,
  db,
  type ChatMessagePart,
  type ChatMessageStatus,
  type ChatRunStatus,
} from "@quieter/database";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { ACTIVE_CHAT_RUN_STATUSES } from "./chat-run-stream";

const ACTIVE_RUN_CONFLICT_INDEX = "chat_run_one_active_per_chat";
const STALE_RUN_MS = 3 * 60 * 1_000;
const STALE_RUN_ERROR = "Generation stopped unexpectedly. Send your message again.";
const EMPTY_ASSISTANT_PARTS: ChatMessagePart[] = [{ content: "", type: "text" }];

export class ActiveChatRunConflictError extends Error {
  constructor() {
    super("This chat already has a generation in progress.");
    this.name = "ActiveChatRunConflictError";
  }
}

const getPostgresErrorField = (
  error: unknown,
  field: "code" | "constraint",
): string | undefined => {
  if (!error || typeof error !== "object") {
    return;
  }

  const value = Reflect.get(error, field);
  return typeof value === "string"
    ? value
    : getPostgresErrorField(Reflect.get(error, "cause"), field);
};

const rethrowChatRunConflict = (error: unknown): never => {
  const isConflict =
    getPostgresErrorField(error, "code") === "23505" &&
    [undefined, ACTIVE_RUN_CONFLICT_INDEX].includes(getPostgresErrorField(error, "constraint"));

  if (isConflict) {
    throw new ActiveChatRunConflictError();
  }

  throw error;
};

export const updateRunStatus = async (
  runId: string,
  status: ChatRunStatus,
  extra?: { error?: string | null; lastHeartbeatAt?: Date },
) => {
  const now = new Date();
  await db
    .update(chatRun)
    .set({
      error: extra?.error,
      lastHeartbeatAt: extra?.lastHeartbeatAt ?? now,
      status,
      updatedAt: now,
    })
    .where(eq(chatRun.id, runId));
};

export const updateAssistantMessage = async (input: {
  assistantMessageId: string;
  error?: string | null;
  parts: ChatMessagePart[];
  status: ChatMessageStatus;
}) => {
  await db
    .update(chatMessage)
    .set({
      error: input.error,
      parts: input.parts,
      status: input.status,
    })
    .where(eq(chatMessage.id, input.assistantMessageId));
};

export const isCancelRequested = async (runId: string) => {
  const [row] = await db
    .select({ cancelRequestedAt: chatRun.cancelRequestedAt })
    .from(chatRun)
    .where(eq(chatRun.id, runId))
    .limit(1);
  return !!row?.cancelRequestedAt;
};

export const getAuthorizedChatRun = async (runId: string, userId: string) => {
  const [run] = await db
    .select()
    .from(chatRun)
    .where(and(eq(chatRun.id, runId), eq(chatRun.userId, userId)))
    .limit(1);
  return run ?? null;
};

const hasVisibleAssistantContent = (parts: ChatMessagePart[]) =>
  parts.some((part) => {
    if (part.type === "tool-call" || part.type === "tool-result") {
      return true;
    }

    return (
      (part.type === "text" || part.type === "thinking") &&
      typeof part.content === "string" &&
      part.content.trim().length > 0
    );
  });

const failStaleChatRun = async (run: { assistantMessageId: string; id: string }) => {
  const [assistantMessage] = await db
    .select({ parts: chatMessage.parts })
    .from(chatMessage)
    .where(eq(chatMessage.id, run.assistantMessageId))
    .limit(1);

  await Promise.all([
    updateAssistantMessage({
      assistantMessageId: run.assistantMessageId,
      error: STALE_RUN_ERROR,
      parts: assistantMessage?.parts ?? EMPTY_ASSISTANT_PARTS,
      status: "failed",
    }),
    updateRunStatus(run.id, "failed", { error: STALE_RUN_ERROR }),
  ]);
};

export const getActiveChatRunSummary = async (chatId: string) => {
  const [activeRun] = await db
    .select({
      assistantMessageId: chatRun.assistantMessageId,
      cancelRequestedAt: chatRun.cancelRequestedAt,
      createdAt: chatRun.createdAt,
      error: chatRun.error,
      id: chatRun.id,
      lastHeartbeatAt: chatRun.lastHeartbeatAt,
      status: chatRun.status,
      updatedAt: chatRun.updatedAt,
    })
    .from(chatRun)
    .where(and(eq(chatRun.chatId, chatId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])))
    .orderBy(desc(chatRun.createdAt))
    .limit(1);

  if (!activeRun) {
    return null;
  }

  const [assistantMessage] = await db
    .select({ parts: chatMessage.parts })
    .from(chatMessage)
    .where(eq(chatMessage.id, activeRun.assistantMessageId))
    .limit(1);
  const lastActivity = activeRun.lastHeartbeatAt ?? activeRun.updatedAt ?? activeRun.createdAt;
  const isStale = Date.now() - lastActivity.getTime() > STALE_RUN_MS;
  const isEmptyAndStale =
    Date.now() - activeRun.createdAt.getTime() > STALE_RUN_MS &&
    !hasVisibleAssistantContent(assistantMessage?.parts ?? []);

  if (isStale || isEmptyAndStale) {
    await failStaleChatRun(activeRun);
    return null;
  }

  return {
    assistantMessageId: activeRun.assistantMessageId,
    cancelRequestedAt: activeRun.cancelRequestedAt,
    error: activeRun.error,
    id: activeRun.id,
    status: activeRun.status,
  };
};

export const hasActiveChatRun = async (chatId: string) => !!(await getActiveChatRunSummary(chatId));

const createAssistantMessage = (input: {
  chatId: string;
  createdAt: Date;
  id: string;
  position: number;
  userId: string;
}) =>
  db.insert(chatMessage).values({
    chatId: input.chatId,
    createdAt: input.createdAt,
    id: input.id,
    parts: EMPTY_ASSISTANT_PARTS,
    position: input.position,
    role: "assistant",
    status: "draft",
    userId: input.userId,
  });

const createRun = (input: {
  assistantMessageId: string;
  chatId: string;
  createdAt: Date;
  mailboxCategory: string;
  mailboxId: string;
  model: ChatModel;
  runId: string;
  userId: string;
}) =>
  db.insert(chatRun).values({
    assistantMessageId: input.assistantMessageId,
    chatId: input.chatId,
    createdAt: input.createdAt,
    id: input.runId,
    lastHeartbeatAt: input.createdAt,
    mailboxCategory: input.mailboxCategory,
    mailboxId: input.mailboxId,
    model: input.model,
    status: "queued",
    updatedAt: input.createdAt,
    userId: input.userId,
  });

export const createChatRunRecords = async (input: {
  assistantMessageId: string;
  chatId: string;
  mailboxCategory: string;
  mailboxId: string;
  model: ChatModel;
  runId: string;
  userId: string;
  userMessage: {
    id: string;
    parts: ChatMessagePart[];
    position: number;
  };
}) => {
  const now = new Date();

  try {
    await db.batch([
      db.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        id: input.userMessage.id,
        parts: input.userMessage.parts,
        position: input.userMessage.position,
        role: "user",
        status: "complete",
        userId: input.userId,
      }),
      createAssistantMessage({
        chatId: input.chatId,
        createdAt: now,
        id: input.assistantMessageId,
        position: input.userMessage.position + 1,
        userId: input.userId,
      }),
      createRun({
        ...input,
        createdAt: now,
      }),
      db.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId)),
    ]);
  } catch (error) {
    rethrowChatRunConflict(error);
  }
};

export const startAssistantRun = async (input: {
  chatId: string;
  mailboxCategory: string;
  mailboxId: string;
  model: ChatModel;
  userId: string;
  userMessage?: {
    id: string;
    parts: ChatMessagePart[];
  };
  userMessagePosition: number;
}) => {
  const runId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const now = new Date();

  try {
    await db.batch([
      db
        .delete(chatMessage)
        .where(
          and(
            eq(chatMessage.chatId, input.chatId),
            gt(chatMessage.position, input.userMessagePosition),
          ),
        ),
      ...(input.userMessage
        ? [
            db
              .update(chatMessage)
              .set({ parts: input.userMessage.parts })
              .where(
                and(
                  eq(chatMessage.id, input.userMessage.id),
                  eq(chatMessage.chatId, input.chatId),
                  eq(chatMessage.role, "user"),
                ),
              ),
          ]
        : []),
      createAssistantMessage({
        chatId: input.chatId,
        createdAt: now,
        id: assistantMessageId,
        position: input.userMessagePosition + 1,
        userId: input.userId,
      }),
      createRun({
        assistantMessageId,
        chatId: input.chatId,
        createdAt: now,
        mailboxCategory: input.mailboxCategory,
        mailboxId: input.mailboxId,
        model: input.model,
        runId,
        userId: input.userId,
      }),
      db.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId)),
    ]);
  } catch (error) {
    rethrowChatRunConflict(error);
  }

  return { assistantMessageId, runId };
};

export const continueAssistantRun = async (input: {
  chatId: string;
  mailboxCategory: string;
  mailboxId: string;
  model: ChatModel;
  previousAssistant: {
    id: string;
    parts: ChatMessagePart[];
    position: number;
  };
  userId: string;
}) => {
  const runId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const now = new Date();

  try {
    await db.batch([
      db
        .update(chatMessage)
        .set({
          error: null,
          parts: input.previousAssistant.parts,
          status: "complete",
        })
        .where(
          and(
            eq(chatMessage.id, input.previousAssistant.id),
            eq(chatMessage.chatId, input.chatId),
            eq(chatMessage.userId, input.userId),
            eq(chatMessage.role, "assistant"),
          ),
        ),
      createAssistantMessage({
        chatId: input.chatId,
        createdAt: now,
        id: assistantMessageId,
        position: input.previousAssistant.position + 1,
        userId: input.userId,
      }),
      createRun({
        assistantMessageId,
        chatId: input.chatId,
        createdAt: now,
        mailboxCategory: input.mailboxCategory,
        mailboxId: input.mailboxId,
        model: input.model,
        runId,
        userId: input.userId,
      }),
      db.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId)),
    ]);
  } catch (error) {
    rethrowChatRunConflict(error);
  }

  return { assistantMessageId, runId };
};
