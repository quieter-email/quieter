import { ORPCError } from "@orpc/server";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import {
  OPENROUTER_TRANSCRIPTION_MODEL,
  openRouterAudioFormatSchema,
} from "@quieter/ai/transcription-format";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { chat, chatMessage } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { assertCanUseAi } from "../ai-access";
import { loadAiAgentContext, serializeAiAgentContext } from "../ai-memory";
import {
  cancelForegroundExchangeParts,
  normalizeExpiredChatParts,
  replaceChatParts,
} from "../chat/continuation";
import { assertAccessibleMailbox } from "../mailbox/service";
import { mailboxIdSchema, protectedProcedure } from "./base";

const chatIdSchema = z.string().trim().min(1).max(128);
const chatTitleSchema = z.string().trim().min(1).max(120);
const chatAudioTranscriptionSchema = z.object({
  audioBase64: z.string().trim().min(1).max(14_000_000),
  chatId: chatIdSchema.optional(),
  durationMs: z.number().int().nonnegative().max(60_000),
  format: openRouterAudioFormatSchema,
  mailboxId: mailboxIdSchema,
  mode: z.enum(["chat", "email"]).default("chat"),
});

const findAuthorizedChat = async (
  chatId: string,
  mailboxId: string,
  userId: string
) => {
  const [authorizedChat] = await db
    .select()
    .from(chat)
    .where(
      and(
        eq(chat.id, chatId),
        eq(chat.mailboxId, mailboxId),
        eq(chat.userId, userId)
      )
    )
    .limit(1);
  if (authorizedChat === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Chat not found." });
  }
  return authorizedChat;
};

const getAuthorizedChat = async (
  chatId: string,
  mailboxId: string,
  userId: string
) => {
  const [, authorizedChat] = await Promise.all([
    assertAccessibleMailbox({ mailboxId, userId }),
    findAuthorizedChat(chatId, mailboxId, userId),
  ]);
  return authorizedChat;
};

export const chatRouter = {
  cancel: protectedProcedure
    .input(
      z.object({
        assistantMessageId: z.uuid(),
        chatId: chatIdSchema,
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      await db
        .insert(chat)
        .values({
          createdAt: new Date(),
          id: input.chatId,
          mailboxId: input.mailboxId,
          title: null,
          updatedAt: new Date(),
          userId: context.userId,
        })
        .onConflictDoNothing();
      const [authorizedChat] = await db
        .select({ id: chat.id })
        .from(chat)
        .where(
          and(
            eq(chat.id, input.chatId),
            eq(chat.mailboxId, input.mailboxId),
            eq(chat.userId, context.userId)
          )
        )
        .limit(1);
      if (authorizedChat === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Chat not found." });
      }
      const [message] = await db
        .select({ parts: chatMessage.parts })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.id, input.assistantMessageId),
            eq(chatMessage.chatId, input.chatId),
            eq(chatMessage.userId, context.userId),
            eq(chatMessage.role, "assistant")
          )
        )
        .limit(1);
      if (message === undefined) {
        const [lastMessage] = await db
          .select({
            parts: chatMessage.parts,
            position: chatMessage.position,
            role: chatMessage.role,
          })
          .from(chatMessage)
          .where(
            and(
              eq(chatMessage.chatId, input.chatId),
              eq(chatMessage.userId, context.userId)
            )
          )
          .orderBy(desc(chatMessage.position))
          .limit(1);
        const belongsToExchange = lastMessage?.parts.some((part) => {
          const { foreground } = part;
          return (
            part.type === "data-foreground" &&
            typeof foreground === "object" &&
            foreground !== null &&
            "exchangeId" in foreground &&
            foreground.exchangeId === input.assistantMessageId
          );
        });
        if (lastMessage === undefined) {
          const [cancelled] = await db
            .insert(chatMessage)
            .values({
              chatId: input.chatId,
              createdAt: new Date(),
              id: input.assistantMessageId,
              parts: [{ type: "data-foreground-cancelled" }],
              position: 0,
              role: "assistant",
              userId: context.userId,
            })
            .onConflictDoNothing()
            .returning({ id: chatMessage.id });
          return { cancelled: cancelled !== undefined };
        }
        if (lastMessage.role !== "user" || !belongsToExchange) {
          return { cancelled: false };
        }
        const [cancelled] = await db
          .insert(chatMessage)
          .values({
            chatId: input.chatId,
            createdAt: new Date(),
            id: input.assistantMessageId,
            parts: [{ type: "data-foreground-cancelled" }],
            position: lastMessage.position + 1,
            role: "assistant",
            userId: context.userId,
          })
          .onConflictDoNothing()
          .returning({ id: chatMessage.id });
        return { cancelled: cancelled !== undefined };
      }
      const parts = cancelForegroundExchangeParts(message.parts);
      if (parts === message.parts) {
        return { cancelled: false };
      }
      const cancelled = await replaceChatParts({
        chatId: input.chatId,
        expectedParts: message.parts,
        messageId: input.assistantMessageId,
        parts,
        userId: context.userId,
      });
      return { cancelled };
    }),

  delete: protectedProcedure
    .input(z.object({ chatId: chatIdSchema, mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(
        input.chatId,
        input.mailboxId,
        context.userId
      );
      await db
        .delete(chat)
        .where(
          and(
            eq(chat.id, authorizedChat.id),
            eq(chat.mailboxId, input.mailboxId),
            eq(chat.userId, context.userId)
          )
        );
      return { deleted: true, id: authorizedChat.id };
    }),

  get: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ chatId: chatIdSchema, mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const authorizedChat = await getAuthorizedChat(
        input.chatId,
        input.mailboxId,
        context.userId
      );
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
      const normalizedMessages = await Promise.all(
        messages.map(async (message) => {
          const parts = normalizeExpiredChatParts(message.parts);
          if (parts === message.parts) {
            return message;
          }
          const normalized = await replaceChatParts({
            chatId: authorizedChat.id,
            expectedParts: message.parts,
            messageId: message.id,
            parts,
            userId: context.userId,
          });
          return normalized ? { ...message, parts } : message;
        })
      );
      return {
        createdAt: authorizedChat.createdAt,
        id: authorizedChat.id,
        mailboxId: authorizedChat.mailboxId,
        messages: normalizedMessages,
        title: authorizedChat.title,
        updatedAt: authorizedChat.updatedAt,
      };
    }),

  list: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      return await db
        .select({
          createdAt: chat.createdAt,
          id: chat.id,
          title: chat.title,
          updatedAt: chat.updatedAt,
        })
        .from(chat)
        .where(
          and(
            eq(chat.mailboxId, input.mailboxId),
            eq(chat.userId, context.userId)
          )
        )
        .orderBy(desc(chat.updatedAt));
    }),

  rename: protectedProcedure
    .input(
      z.object({
        chatId: chatIdSchema,
        mailboxId: mailboxIdSchema,
        title: chatTitleSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await getAuthorizedChat(input.chatId, input.mailboxId, context.userId);
      const [updatedChat] = await db
        .update(chat)
        .set({ title: input.title, updatedAt: new Date() })
        .where(
          and(
            eq(chat.id, input.chatId),
            eq(chat.mailboxId, input.mailboxId),
            eq(chat.userId, context.userId)
          )
        )
        .returning({
          createdAt: chat.createdAt,
          id: chat.id,
          title: chat.title,
          updatedAt: chat.updatedAt,
        });
      return updatedChat;
    }),

  transcribeAudio: protectedProcedure
    .input(chatAudioTranscriptionSchema)
    .handler(async ({ context, input }) => {
      const accessibleMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      await assertCanUseAi({
        organizationId: accessibleMailbox.organizationId ?? undefined,
        userId: context.userId,
      });
      if (input.chatId !== undefined) {
        await findAuthorizedChat(input.chatId, input.mailboxId, context.userId);
      }

      const { generateOpenRouterTranscription } =
        await import("@quieter/ai/openrouter-transcription");
      let result: Awaited<ReturnType<typeof generateOpenRouterTranscription>>;
      try {
        result = await generateOpenRouterTranscription({
          audioBase64: input.audioBase64,
          format: input.format,
        });
      } catch (error: unknown) {
        reportError(error, { operation: "chat:transcribe-audio" });
        const message =
          error instanceof Error &&
          (error.message.startsWith("Transcription ") ||
            error.message.startsWith("We could not transcribe "))
            ? error.message
            : "We could not transcribe that recording. Try recording it again.";
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
      }
      const text = result.text.trim();
      if (!text) {
        throw new ORPCError("BAD_REQUEST", {
          message: "No speech was detected.",
        });
      }

      const responseText =
        input.mode === "email"
          ? await (async () => {
              const { formatTranscribedEmail } =
                await import("@quieter/ai/format-transcribed-email");
              const memoryContext = await loadAiAgentContext({
                agent: "compose",
                mailboxId: input.mailboxId,
                query: text,
                userId: context.userId,
              });
              try {
                return await formatTranscribedEmail({
                  memoryContext: serializeAiAgentContext(memoryContext),
                  onUsage: (usage) => {
                    void reportAiUsage({
                      chatId: input.chatId ?? null,
                      completionTokens: usage.completionTokens,
                      costUsd: usage.costUsd,
                      externalId: `chat-transcription-format:${crypto.randomUUID()}`,
                      mailboxId: input.mailboxId,
                      model: resolveBackgroundModel(),
                      promptTokens: usage.promptTokens,
                      promptTokensDetails: {
                        cacheWriteTokens: usage.cacheWriteTokens,
                        cachedTokens: usage.cachedTokens,
                      },
                      usageKind: "aiChat",
                      userId: context.userId,
                    }).catch((error: unknown) => {
                      reportError(error, {
                        operation: "chat:report-transcription-usage",
                      });
                    });
                  },
                  transcript: text,
                });
              } catch (error: unknown) {
                reportError(error, {
                  operation: "chat:format-transcribed-email",
                });
                return text;
              }
            })()
          : text;

      const { cost } = result.usage;
      if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
        await reportAiUsage({
          chatId: input.chatId ?? null,
          completionTokens: result.usage.completionTokens,
          costUsd: cost,
          externalId: `chat-transcription:${crypto.randomUUID()}`,
          mailboxId: input.mailboxId,
          model: OPENROUTER_TRANSCRIPTION_MODEL,
          promptTokens: result.usage.promptTokens,
          usageKind: "aiChat",
          userId: context.userId,
        });
      }
      return { text: responseText };
    }),
};
