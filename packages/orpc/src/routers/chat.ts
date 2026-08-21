import { ORPCError } from "@orpc/server";
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

import { loadAiAgentContext, serializeAiAgentContext } from "../ai-memory";
import { assertAiChatCredits } from "../chat/access";
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
      return {
        createdAt: authorizedChat.createdAt,
        id: authorizedChat.id,
        mailboxId: authorizedChat.mailboxId,
        messages,
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
      await assertAiChatCredits({
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
              const { formatTranscribedEmail, TRANSCRIBED_EMAIL_FORMAT_MODEL } =
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
                      model: TRANSCRIBED_EMAIL_FORMAT_MODEL,
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
