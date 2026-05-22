import { ORPCError } from "@orpc/server";
import {
  chat,
  chatMessage,
  db,
  type ChatMessagePart,
  type ChatMessageRole,
} from "@quieter/database";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "./base";

const chatIdSchema = z.string().trim().min(1);
const chatTitleSchema = z.string().trim().min(1).max(120);
const chatMessagePartSchema = z.custom<ChatMessagePart>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    value.type.trim().length > 0,
);
const chatMessageSchema = z.object({
  id: z.string().trim().min(1),
  role: z.enum(["system", "user", "assistant"] satisfies ChatMessageRole[]),
  parts: z.array(chatMessagePartSchema),
  createdAt: z.coerce.date().optional(),
});

type ChatMessageInput = z.infer<typeof chatMessageSchema>;

const getTextContent = (message: ChatMessageInput) =>
  message.parts
    .flatMap((part) =>
      part.type === "text" && "content" in part && typeof part.content === "string"
        ? [part.content]
        : [],
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const createFallbackTitle = (messages: ChatMessageInput[]) => {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && getTextContent(message),
  );
  const firstMessage = firstUserMessage ?? messages.find((message) => getTextContent(message));
  const title = firstMessage ? getTextContent(firstMessage) : "";

  return title ? title.slice(0, 80) : null;
};

const getAuthorizedChat = async (chatId: string, userId: string) => {
  const [authorizedChat] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);

  if (!authorizedChat) {
    throw new ORPCError("NOT_FOUND", {
      message: "Chat not found.",
    });
  }

  return authorizedChat;
};

export const chatRouter = {
  list: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
    return await db
      .select({
        createdAt: chat.createdAt,
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
      })
      .from(chat)
      .where(eq(chat.userId, context.userId))
      .orderBy(desc(chat.updatedAt));
  }),

  create: protectedProcedure.handler(async ({ context }) => {
    const now = new Date();
    const [createdChat] = await db
      .insert(chat)
      .values({
        createdAt: now,
        id: crypto.randomUUID(),
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
        title: chatTitleSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, context.userId);
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
    .input(z.object({ chatId: chatIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, context.userId);

      await db.delete(chatMessage).where(eq(chatMessage.chatId, authorizedChat.id));
      await db.delete(chat).where(eq(chat.id, authorizedChat.id));

      return { deleted: true, id: authorizedChat.id };
    }),

  get: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ chatId: chatIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, context.userId);
      const messages = await db
        .select({
          createdAt: chatMessage.createdAt,
          id: chatMessage.id,
          parts: chatMessage.parts,
          position: chatMessage.position,
          role: chatMessage.role,
        })
        .from(chatMessage)
        .where(eq(chatMessage.chatId, authorizedChat.id))
        .orderBy(chatMessage.position);

      return {
        createdAt: authorizedChat.createdAt,
        id: authorizedChat.id,
        messages: messages.map((message) => ({
          createdAt: message.createdAt,
          id: message.id,
          parts: message.parts,
          role: message.role,
        })),
        title: authorizedChat.title,
        updatedAt: authorizedChat.updatedAt,
      };
    }),

  saveMessages: protectedProcedure
    .input(
      z.object({
        chatId: chatIdSchema,
        messages: z.array(chatMessageSchema).max(200),
      }),
    )
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(input.chatId, context.userId);
      const now = new Date();
      const title = authorizedChat.title ?? createFallbackTitle(input.messages);

      const messageIds = input.messages.map((message) => message.id);

      if (messageIds.length === 0) {
        await db.delete(chatMessage).where(eq(chatMessage.chatId, authorizedChat.id));
      } else {
        await db
          .delete(chatMessage)
          .where(
            and(eq(chatMessage.chatId, authorizedChat.id), notInArray(chatMessage.id, messageIds)),
          );

        await db
          .insert(chatMessage)
          .values(
            input.messages.map((message, position) => {
              const createdAt = message.createdAt ?? now;
              const parts = message.parts as ChatMessagePart[];

              return {
                chatId: authorizedChat.id,
                createdAt,
                id: message.id,
                parts,
                position,
                role: message.role,
                userId: context.userId,
              };
            }),
          )
          .onConflictDoUpdate({
            target: chatMessage.id,
            set: {
              parts: sql.raw(`excluded."parts"`),
              position: sql.raw(`excluded."position"`),
              role: sql.raw(`excluded."role"`),
            },
          });
      }

      const [updatedChat] = await db
        .update(chat)
        .set({
          title,
          updatedAt: now,
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
};
