import { ORPCError } from "@orpc/server";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { chat, chatMessage, chatRun, db, type ChatMessagePart } from "@quieter/database";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ActiveChatRunConflictError,
  createChatRunRecords,
  getActiveChatRunSummary,
  hasActiveChatRun,
  startAssistantRun,
} from "../chat-run-store";
import { assertAccessibleMailbox } from "../mailbox";
import { mailboxCategorySchema, mailboxIdSchema, protectedProcedure } from "./base";

const chatIdSchema = z.string().trim().min(1);
const chatTitleSchema = z.string().trim().min(1).max(120);
const chatPromptSchema = z.string().trim().min(1).max(10_000);

const findAuthorizedChat = async (chatId: string, mailboxId: string, userId: string) => {
  const [authorizedChat] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.mailboxId, mailboxId), eq(chat.userId, userId)))
    .limit(1);

  if (!authorizedChat) {
    throw new ORPCError("NOT_FOUND", {
      message: "Chat not found.",
    });
  }

  return authorizedChat;
};

const getAuthorizedChat = async (chatId: string, mailboxId: string, userId: string) => {
  const [, authorizedChat] = await Promise.all([
    assertAccessibleMailbox({ mailboxId, userId }),
    findAuthorizedChat(chatId, mailboxId, userId),
  ]);
  return authorizedChat;
};

const listChatMessages = async (chatId: string) => {
  const messages = await db
    .select({
      createdAt: chatMessage.createdAt,
      error: chatMessage.error,
      id: chatMessage.id,
      parts: chatMessage.parts,
      role: chatMessage.role,
      status: chatMessage.status,
    })
    .from(chatMessage)
    .where(eq(chatMessage.chatId, chatId))
    .orderBy(chatMessage.position);

  return messages.map((message) => ({
    createdAt: message.createdAt,
    error: message.error,
    id: message.id,
    parts: message.parts,
    role: message.role,
    status: message.status,
  }));
};

const assertCanRunChatGeneration = async (input: {
  chatId: string;
  mailboxId: string;
  userId: string;
}) => {
  const [authorizedChat, accessibleMailbox, entitlement] = await Promise.all([
    findAuthorizedChat(input.chatId, input.mailboxId, input.userId),
    assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: input.userId,
    }),
    hasUserBillingFeature({
      feature: "aiChat",
      userId: input.userId,
    }),
  ]);

  if (accessibleMailbox.provider !== "gmail") {
    throw new ORPCError("BAD_REQUEST", {
      message: "AI chat search currently supports Gmail mailboxes only.",
    });
  }

  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: `AI chat requires the ${BILLING_FEATURES.aiChat.requiredPlan} plan.`,
    });
  }

  if (await hasActiveChatRun(authorizedChat.id)) {
    throw new ORPCError("CONFLICT", {
      message: "This chat already has a generation in progress.",
    });
  }

  return authorizedChat;
};

const rethrowChatRunConflict = (error: unknown): never => {
  if (error instanceof ActiveChatRunConflictError) {
    throw new ORPCError("CONFLICT", {
      message: error.message,
    });
  }

  throw error;
};

const startAssistantRunOrThrow = (input: Parameters<typeof startAssistantRun>[0]) =>
  startAssistantRun(input).catch(rethrowChatRunConflict);

const buildRunResponse = async ({
  assistantMessageId,
  chatId,
  runId,
  userMessageId,
}: {
  assistantMessageId: string;
  chatId: string;
  runId: string;
  userMessageId: string;
}) => {
  const [activeRun, messages] = await Promise.all([
    getActiveChatRunSummary(chatId),
    listChatMessages(chatId),
  ]);

  return {
    activeRun,
    assistantMessageId,
    chatId,
    messages,
    runId,
    userMessageId,
  };
};

export const chatRouter = {
  list: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({ mailboxId: input.mailboxId, userId: context.userId });

      return await db
        .select({
          createdAt: chat.createdAt,
          id: chat.id,
          title: chat.title,
          updatedAt: chat.updatedAt,
        })
        .from(chat)
        .where(and(eq(chat.mailboxId, input.mailboxId), eq(chat.userId, context.userId)))
        .orderBy(desc(chat.updatedAt));
    }),

  create: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({ mailboxId: input.mailboxId, userId: context.userId });

      const now = new Date();
      const [createdChat] = await db
        .insert(chat)
        .values({
          createdAt: now,
          id: crypto.randomUUID(),
          mailboxId: input.mailboxId,
          title: null,
          updatedAt: now,
          userId: context.userId,
        })
        .returning({
          createdAt: chat.createdAt,
          id: chat.id,
          title: chat.title,
          updatedAt: chat.updatedAt,
        });

      return createdChat!;
    }),

  rename: protectedProcedure
    .input(
      z.object({
        chatId: chatIdSchema,
        mailboxId: mailboxIdSchema,
        title: chatTitleSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, input.mailboxId, context.userId);
      const [updatedChat] = await db
        .update(chat)
        .set({
          title: input.title,
          updatedAt: new Date(),
        })
        .where(eq(chat.id, authorizedChat.id))
        .returning({
          createdAt: chat.createdAt,
          id: chat.id,
          title: chat.title,
          updatedAt: chat.updatedAt,
        });

      return updatedChat!;
    }),

  delete: protectedProcedure
    .input(z.object({ chatId: chatIdSchema, mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, input.mailboxId, context.userId);

      await db.delete(chat).where(eq(chat.id, authorizedChat.id));

      return { deleted: true, id: authorizedChat.id };
    }),

  get: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ chatId: chatIdSchema, mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, input.mailboxId, context.userId);
      const messages = await db
        .select({
          createdAt: chatMessage.createdAt,
          error: chatMessage.error,
          id: chatMessage.id,
          parts: chatMessage.parts,
          position: chatMessage.position,
          role: chatMessage.role,
          status: chatMessage.status,
        })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, authorizedChat.id))
        .orderBy(chatMessage.position);
      const activeRun = await getActiveChatRunSummary(authorizedChat.id);

      return {
        activeRun,
        createdAt: authorizedChat.createdAt,
        id: authorizedChat.id,
        messages: messages.map((message) => ({
          createdAt: message.createdAt,
          error: message.error,
          id: message.id,
          parts: message.parts,
          role: message.role,
          status: message.status,
        })),
        title: authorizedChat.title,
        updatedAt: authorizedChat.updatedAt,
      };
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        category: mailboxCategorySchema,
        chatId: chatIdSchema,
        mailboxId: mailboxIdSchema,
        message: chatPromptSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const authorizedChat = await assertCanRunChatGeneration({
        chatId: input.chatId,
        mailboxId: input.mailboxId,
        userId: context.userId,
      });

      const [lastMessage] = await db
        .select({ position: chatMessage.position })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, authorizedChat.id))
        .orderBy(desc(chatMessage.position))
        .limit(1);
      const nextPosition = (lastMessage?.position ?? -1) + 1;
      const runId = crypto.randomUUID();
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();
      const userParts: ChatMessagePart[] = [{ content: input.message, type: "text" }];

      try {
        await createChatRunRecords({
          assistantMessageId,
          chatId: authorizedChat.id,
          mailboxCategory: input.category,
          mailboxId: input.mailboxId,
          runId,
          userId: context.userId,
          userMessage: {
            id: userMessageId,
            parts: userParts,
            position: nextPosition,
          },
        });
      } catch (error) {
        rethrowChatRunConflict(error);
      }

      return buildRunResponse({
        assistantMessageId,
        chatId: authorizedChat.id,
        runId,
        userMessageId,
      });
    }),

  editUserMessage: protectedProcedure
    .input(
      z.object({
        category: mailboxCategorySchema,
        chatId: chatIdSchema,
        mailboxId: mailboxIdSchema,
        message: chatPromptSchema,
        userMessageId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const authorizedChat = await assertCanRunChatGeneration({
        chatId: input.chatId,
        mailboxId: input.mailboxId,
        userId: context.userId,
      });

      const [userMessage] = await db
        .select({
          id: chatMessage.id,
          position: chatMessage.position,
        })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.id, input.userMessageId),
            eq(chatMessage.chatId, authorizedChat.id),
            eq(chatMessage.role, "user"),
          ),
        )
        .limit(1);

      if (!userMessage) {
        throw new ORPCError("NOT_FOUND", {
          message: "User message not found.",
        });
      }

      const userParts: ChatMessagePart[] = [{ content: input.message, type: "text" }];

      const { assistantMessageId, runId } = await startAssistantRunOrThrow({
        chatId: authorizedChat.id,
        mailboxCategory: input.category,
        mailboxId: input.mailboxId,
        userId: context.userId,
        userMessage: {
          id: userMessage.id,
          parts: userParts,
        },
        userMessagePosition: userMessage.position,
      });

      return buildRunResponse({
        assistantMessageId,
        chatId: authorizedChat.id,
        runId,
        userMessageId: userMessage.id,
      });
    }),

  regenerateResponse: protectedProcedure
    .input(
      z.object({
        assistantMessageId: z.string().trim().min(1),
        category: mailboxCategorySchema,
        chatId: chatIdSchema,
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const authorizedChat = await assertCanRunChatGeneration({
        chatId: input.chatId,
        mailboxId: input.mailboxId,
        userId: context.userId,
      });

      const [assistantMessage] = await db
        .select({
          id: chatMessage.id,
          position: chatMessage.position,
          status: chatMessage.status,
        })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.id, input.assistantMessageId),
            eq(chatMessage.chatId, authorizedChat.id),
            eq(chatMessage.role, "assistant"),
          ),
        )
        .limit(1);

      if (!assistantMessage) {
        throw new ORPCError("NOT_FOUND", {
          message: "Assistant message not found.",
        });
      }

      if (assistantMessage.status === "draft") {
        throw new ORPCError("CONFLICT", {
          message: "This response is still generating.",
        });
      }

      const [userMessage] = await db
        .select({ id: chatMessage.id, position: chatMessage.position })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.chatId, authorizedChat.id),
            eq(chatMessage.position, assistantMessage.position - 1),
            eq(chatMessage.role, "user"),
          ),
        )
        .limit(1);

      if (!userMessage) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Could not find the user message for this response.",
        });
      }

      const { assistantMessageId, runId } = await startAssistantRunOrThrow({
        chatId: authorizedChat.id,
        mailboxCategory: input.category,
        mailboxId: input.mailboxId,
        userId: context.userId,
        userMessagePosition: userMessage.position,
      });

      return buildRunResponse({
        assistantMessageId,
        chatId: authorizedChat.id,
        runId,
        userMessageId: userMessage.id,
      });
    }),

  cancelGeneration: protectedProcedure
    .input(z.object({ chatId: chatIdSchema, mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, input.mailboxId, context.userId);
      const activeRun = await getActiveChatRunSummary(authorizedChat.id);

      if (!activeRun) {
        return { cancelled: false };
      }

      await db
        .update(chatRun)
        .set({
          cancelRequestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(chatRun.id, activeRun.id));

      return { cancelled: true, runId: activeRun.id };
    }),
};
