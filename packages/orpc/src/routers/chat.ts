import { ORPCError } from "@orpc/server";
import { chatMailContextSchema } from "@quieter/ai/chat-context";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import {
  OPENROUTER_TRANSCRIPTION_MODEL,
  openRouterAudioFormatSchema,
} from "@quieter/ai/transcription-format";
import { reportAiUsage } from "@quieter/billing";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import { chat, chatMessage } from "@quieter/database/schema";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
} from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { assertCanUseAi } from "../ai-access";
import { recordAiGeneratedMailBody } from "../ai-mail-authorship";
import { loadAiAgentContext, serializeAiAgentContext } from "../ai-memory";
import { decodeChatStreamError } from "../chat-errors";
import {
  cancelForegroundExchangeParts,
  FOREGROUND_LEASE_MS,
  normalizeExpiredChatParts,
  replaceChatParts,
} from "../chat/continuation";
import { createAiChatResponse } from "../chat/service";
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

  reply: protectedProcedure
    .input(
      z.object({
        category: mailCategorySchema.default("inbox"),
        chatId: z.uuid(),
        context: chatMailContextSchema.optional(),
        mailboxId: mailboxIdSchema,
        messageId: z.uuid(),
        prompt: z.string().trim().min(1).max(10_000),
      })
    )
    .handler(async ({ context, input, signal }) => {
      try {
        const response = await createAiChatResponse({
          body: {
            category: input.category,
            context: input.context,
            foreground: {
              capabilities: [],
              exchangeId: crypto.randomUUID(),
              expiresAt: Date.now() + FOREGROUND_LEASE_MS,
              generation: 1,
              tabId: input.chatId,
            },
            mailboxId: input.mailboxId,
            message: {
              id: input.messageId,
              parts: [{ text: input.prompt, type: "text" }],
              role: "user",
            },
            threadId: input.chatId,
            trigger: "submit-message",
          },
          request: { signal: signal ?? new AbortController().signal },
          scheduleBackgroundTask: context.scheduleBackgroundTask,
          toolAccess: "read",
          userId: context.userId,
        });
        if (response.body === null) {
          throw new Error("Chat returned no reply stream.");
        }
        const stream = parseJsonEventStream({
          schema: uiMessageChunkSchema,
          stream: response.body,
        }).pipeThrough(
          new TransformStream<
            | { success: true; value: UIMessageChunk }
            | { success: false; error: unknown },
            UIMessageChunk
          >({
            transform(part, controller) {
              if (!part.success) {
                throw part.error;
              }
              controller.enqueue(part.value);
            },
          })
        );
        let reply: UIMessage | undefined;
        for await (const message of readUIMessageStream({
          stream,
          terminateOnError: true,
        })) {
          reply = message;
        }
        return { chatId: input.chatId, reply };
      } catch (error) {
        const decoded =
          error instanceof Error ? decodeChatStreamError(error) : error;
        if (
          decoded instanceof Error &&
          "status" in decoded &&
          typeof decoded.status === "number" &&
          decoded.status >= 400 &&
          decoded.status < 500
        ) {
          throw new ORPCError("CHAT_REQUEST_FAILED", {
            message: decoded.message,
            status: decoded.status,
          });
        }
        throw error;
      }
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
      const transcriptionUsageId = `chat-transcription:${crypto.randomUUID()}`;
      const transcriptionBilling = await createMailboxAiBillingContext({
        externalId: transcriptionUsageId,
        mailboxId: input.mailboxId,
        usageKind: "aiChat",
        userId: context.userId,
      });
      let result: Awaited<ReturnType<typeof generateOpenRouterTranscription>>;
      try {
        result = await generateOpenRouterTranscription({
          audioBase64: input.audioBase64,
          billing: transcriptionBilling,
          format: input.format,
        });
      } catch (error: unknown) {
        if (
          error instanceof ORPCError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          throw error;
        }
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

      const responseText = await (async () => {
        const { formatTranscribedText } =
          await import("@quieter/ai/format-transcribed-text");
        let formatted: string;
        try {
          const memoryContext =
            input.mode === "email"
              ? await loadAiAgentContext({
                  agent: "compose",
                  mailboxId: input.mailboxId,
                  query: text,
                  semantic: { billingMailboxId: input.mailboxId },
                  userId: context.userId,
                })
              : null;
          const formatUsageId = `chat-transcription-format:${crypto.randomUUID()}`;
          formatted = await formatTranscribedText({
            billing: { ...transcriptionBilling, groupId: formatUsageId },
            memoryContext:
              memoryContext === null
                ? null
                : serializeAiAgentContext(memoryContext),
            mode: input.mode,
            onUsage: (usage) => {
              void reportAiUsage({
                chatId: input.chatId ?? null,
                completionTokens: usage.completionTokens,
                costUsd: usage.costUsd,
                externalId: formatUsageId,
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
        } catch (error) {
          if (
            error instanceof ORPCError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            throw error;
          }
          reportError(new Error("Dictation cleanup failed."), {
            operation: "chat:format-transcribed-text",
          });
          return text;
        }
        if (!formatted.trim()) {
          return text;
        }
        if (input.mode === "email") {
          try {
            await recordAiGeneratedMailBody({
              bodyText: formatted,
              mailboxId: input.mailboxId,
              userId: context.userId,
            });
          } catch {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Could not prepare that email. Please try again.",
            });
          }
        }
        return formatted;
      })();

      const { cost } = result.usage;
      if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
        await reportAiUsage({
          chatId: input.chatId ?? null,
          completionTokens: result.usage.completionTokens,
          costUsd: cost,
          externalId: transcriptionUsageId,
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
