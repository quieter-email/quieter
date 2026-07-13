import type { ChatModel } from "@quieter/ai/chat-models";
import { db } from "@quieter/database/client";
import {
  chat,
  chatMessage,
  chatRun,
  type ChatMessagePart,
  type ChatMessageStatus,
  type ChatRunContext,
  type ChatRunStatus,
} from "@quieter/database/schema";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { ACTIVE_CHAT_RUN_STATUSES } from "./chat-run-stream";

const ACTIVE_RUN_CONFLICT_INDEX = "chat_run_one_active_per_chat";
const STALE_RUN_MS = 60_000;
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
  const [updated] = await db
    .update(chatRun)
    .set({
      error: extra?.error,
      lastHeartbeatAt: extra?.lastHeartbeatAt ?? now,
      status,
      updatedAt: now,
    })
    .where(and(eq(chatRun.id, runId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])))
    .returning({ id: chatRun.id });
  return !!updated;
};

export const touchChatRunHeartbeat = async (runId: string) => {
  const now = new Date();
  const [updated] = await db
    .update(chatRun)
    .set({ lastHeartbeatAt: now, updatedAt: now })
    .where(and(eq(chatRun.id, runId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])))
    .returning({ id: chatRun.id });
  return !!updated;
};

export const persistChatRunDraft = async (input: {
  assistantMessageId: string;
  parts: ChatMessagePart[];
  runId: string;
  runStatus?: Extract<ChatRunStatus, "running" | "waiting_on_tool">;
  status?: Extract<ChatMessageStatus, "draft" | "streaming">;
}) => {
  return await db.transaction(async (tx) => {
    const now = new Date();
    const [activeRun] = await tx
      .update(chatRun)
      .set({
        lastHeartbeatAt: now,
        status: input.runStatus ?? "running",
        updatedAt: now,
      })
      .where(
        and(eq(chatRun.id, input.runId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])),
      )
      .returning({ id: chatRun.id });

    if (!activeRun) {
      return false;
    }

    await tx
      .update(chatMessage)
      .set({
        error: null,
        parts: input.parts,
        status: input.status ?? "streaming",
      })
      .where(eq(chatMessage.id, input.assistantMessageId));
    return true;
  });
};

export const terminalizeChatRun = async (input: {
  error?: string | null;
  parts?: ChatMessagePart[];
  runId: string;
  status: Extract<ChatRunStatus, "cancelled" | "complete" | "failed">;
}) =>
  await db.transaction(async (tx) => {
    const now = new Date();
    const [terminalRun] = await tx
      .update(chatRun)
      .set({
        error: input.error ?? null,
        lastHeartbeatAt: now,
        status: input.status,
        updatedAt: now,
      })
      .where(
        and(eq(chatRun.id, input.runId), inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES])),
      )
      .returning({ assistantMessageId: chatRun.assistantMessageId });

    if (!terminalRun) {
      return null;
    }

    const [message] = await tx
      .select({ parts: chatMessage.parts })
      .from(chatMessage)
      .where(eq(chatMessage.id, terminalRun.assistantMessageId))
      .limit(1);
    const parts = input.parts ?? message?.parts ?? EMPTY_ASSISTANT_PARTS;

    await tx
      .update(chatMessage)
      .set({
        error: input.error ?? null,
        parts,
        status: input.status,
      })
      .where(eq(chatMessage.id, terminalRun.assistantMessageId));

    return {
      assistantMessageId: terminalRun.assistantMessageId,
      error: input.error ?? null,
      parts,
      status: input.status,
    };
  });

export const cancelActiveChatRun = async (input: { chatId: string; userId: string }) =>
  await db.transaction(async (tx) => {
    const now = new Date();
    const [cancelledRun] = await tx
      .update(chatRun)
      .set({
        cancelRequestedAt: now,
        error: null,
        lastHeartbeatAt: now,
        status: "cancelled",
        updatedAt: now,
      })
      .where(
        and(
          eq(chatRun.chatId, input.chatId),
          eq(chatRun.userId, input.userId),
          inArray(chatRun.status, [...ACTIVE_CHAT_RUN_STATUSES]),
        ),
      )
      .returning({
        assistantMessageId: chatRun.assistantMessageId,
        id: chatRun.id,
      });

    if (!cancelledRun) {
      return null;
    }

    const [message] = await tx
      .select({ parts: chatMessage.parts })
      .from(chatMessage)
      .where(eq(chatMessage.id, cancelledRun.assistantMessageId))
      .limit(1);
    const parts = message?.parts ?? EMPTY_ASSISTANT_PARTS;

    await tx
      .update(chatMessage)
      .set({ error: null, parts, status: "cancelled" })
      .where(eq(chatMessage.id, cancelledRun.assistantMessageId));

    return {
      assistantMessageId: cancelledRun.assistantMessageId,
      error: null,
      parts,
      runId: cancelledRun.id,
      status: "cancelled" as const,
    };
  });

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

const failStaleChatRun = (run: { id: string; status: ChatRunStatus }) =>
  terminalizeChatRun({
    error:
      run.status === "waiting_on_tool"
        ? "The mail lookup stopped responding. Retry the response to continue."
        : "The response stopped before it finished. Retry it to continue.",
    runId: run.id,
    status: "failed",
  });

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

export const createChatRunRecords = async (input: {
  assistantMessageId: string;
  chatId: string;
  context?: ChatRunContext;
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
    await db.transaction(async (tx) => {
      await tx.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        id: input.userMessage.id,
        parts: input.userMessage.parts,
        position: input.userMessage.position,
        role: "user",
        status: "complete",
        userId: input.userId,
      });
      await tx.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        id: input.assistantMessageId,
        parts: EMPTY_ASSISTANT_PARTS,
        position: input.userMessage.position + 1,
        role: "assistant",
        status: "draft",
        userId: input.userId,
      });
      await tx.insert(chatRun).values({
        assistantMessageId: input.assistantMessageId,
        chatId: input.chatId,
        context: input.context,
        createdAt: now,
        id: input.runId,
        lastHeartbeatAt: now,
        mailboxCategory: input.mailboxCategory,
        mailboxId: input.mailboxId,
        model: input.model,
        status: "queued",
        updatedAt: now,
        userId: input.userId,
      });
      await tx.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId));
    });
  } catch (error) {
    rethrowChatRunConflict(error);
  }
};

export const startAssistantRun = async (input: {
  chatId: string;
  context?: ChatRunContext;
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
    await db.transaction(async (tx) => {
      await tx
        .delete(chatMessage)
        .where(
          and(
            eq(chatMessage.chatId, input.chatId),
            gt(chatMessage.position, input.userMessagePosition),
          ),
        );
      if (input.userMessage) {
        await tx
          .update(chatMessage)
          .set({ parts: input.userMessage.parts })
          .where(
            and(
              eq(chatMessage.id, input.userMessage.id),
              eq(chatMessage.chatId, input.chatId),
              eq(chatMessage.role, "user"),
            ),
          );
      }
      await tx.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        id: assistantMessageId,
        parts: EMPTY_ASSISTANT_PARTS,
        position: input.userMessagePosition + 1,
        role: "assistant",
        status: "draft",
        userId: input.userId,
      });
      await tx.insert(chatRun).values({
        assistantMessageId,
        chatId: input.chatId,
        context: input.context,
        createdAt: now,
        id: runId,
        lastHeartbeatAt: now,
        mailboxCategory: input.mailboxCategory,
        mailboxId: input.mailboxId,
        model: input.model,
        status: "queued",
        updatedAt: now,
        userId: input.userId,
      });
      await tx.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId));
    });
  } catch (error) {
    rethrowChatRunConflict(error);
  }

  return { assistantMessageId, runId };
};

export const continueAssistantRun = async (input: {
  chatId: string;
  context?: ChatRunContext;
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
    await db.transaction(async (tx) => {
      await tx
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
        );
      await tx.insert(chatMessage).values({
        chatId: input.chatId,
        createdAt: now,
        id: assistantMessageId,
        parts: EMPTY_ASSISTANT_PARTS,
        position: input.previousAssistant.position + 1,
        role: "assistant",
        status: "draft",
        userId: input.userId,
      });
      await tx.insert(chatRun).values({
        assistantMessageId,
        chatId: input.chatId,
        context: input.context,
        createdAt: now,
        id: runId,
        lastHeartbeatAt: now,
        mailboxCategory: input.mailboxCategory,
        mailboxId: input.mailboxId,
        model: input.model,
        status: "queued",
        updatedAt: now,
        userId: input.userId,
      });
      await tx.update(chat).set({ updatedAt: now }).where(eq(chat.id, input.chatId));
    });
  } catch (error) {
    rethrowChatRunConflict(error);
  }

  return { assistantMessageId, runId };
};
