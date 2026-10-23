import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import {
  AI_MEMORY_CATEGORIES,
  AI_MEMORY_CONTENT_MAX_LENGTH,
  AI_MEMORY_REQUEST_MAX_LENGTH,
} from "@quieter/ai/ai-memory";
import { AUTO_LABEL_MODEL } from "@quieter/ai/classify-gmail-message";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import {
  MAIL_SEARCH_QUERY_MAX_LENGTH,
  parseMailSearchWithAi,
} from "@quieter/ai/parse-mail-search";
import type { ParsedMailSearch } from "@quieter/ai/parse-mail-search";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { user, userAiContextEvent } from "@quieter/database/schema";
import {
  isMailSearchFilterSupported,
  normalizeStructuredMailSearch,
} from "@quieter/mail/search";
import { reportError } from "@quieter/observability";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { assertCanUseAi } from "../ai-access";
import {
  AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH,
  exportMailboxAiMemory,
  exportPersonalAiMemory,
  forgetAiMemory,
  getPersonalAiMemoryScopeConfig,
  listMailboxAiMemory,
  listPersonalAiMemory,
  loadAiAgentContext,
  purgeMailboxAiMemory,
  purgePersonalAiMemory,
  requestAiMemoryUpdate,
  saveAiMemory,
  searchAiMemory,
  serializeAiAgentContext,
  updateAiMemoryScopeConfig,
} from "../ai-memory";
import {
  listMailboxMemoryBootstraps,
  retryMailboxMemoryBootstrap,
} from "../ai-memory-capture";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  replySuggestionInputSchema,
  requestReplySuggestion,
} from "../reply-suggestion";
import { mailboxIdSchema, protectedProcedure } from "./base";

const memoryTargetSchema = z
  .object({
    mailboxId: z.string().trim().min(1).optional(),
    scope: z.enum(["mailbox", "user"]),
  })
  .superRefine((target, context) => {
    if (
      target.scope === "mailbox" &&
      (target.mailboxId === undefined || target.mailboxId.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose a mailbox.",
        path: ["mailboxId"],
      });
    }
  });

type MemoryTarget = z.infer<typeof memoryTargetSchema>;

const serializeModels = () => {
  const backgroundModel = resolveBackgroundModel();
  return {
    autoLabel: AUTO_LABEL_MODEL,
    searchFilter: backgroundModel,
  };
};

const loadSettings = async (userId: string) => {
  const [memoryConfig, learning] = await Promise.all([
    getPersonalAiMemoryScopeConfig(userId),
    listMailboxMemoryBootstraps(userId),
  ]);
  const pending =
    learning.length === 0
      ? []
      : await db
          .select({
            failedCount:
              sql<number>`count(*) filter (where ${userAiContextEvent.lastError} is not null)`.mapWith(
                Number
              ),
            mailboxId: userAiContextEvent.mailboxId,
            needsBalance: sql<boolean>`bool_or(${userAiContextEvent.lastError} like '%usage balance%')`,
            pendingCount: count(),
          })
          .from(userAiContextEvent)
          .where(
            and(
              eq(userAiContextEvent.userId, userId),
              inArray(
                userAiContextEvent.mailboxId,
                learning.map((item) => item.mailboxId)
              ),
              eq(sql`${userAiContextEvent.metadata}->>'memoryScope'`, "user"),
              isNull(userAiContextEvent.mergedAt),
              isNull(userAiContextEvent.skippedAt)
            )
          )
          .groupBy(userAiContextEvent.mailboxId);
  const pendingByMailbox = new Map(
    pending.map((item) => [item.mailboxId, item])
  );
  return {
    memory: {
      enabled: memoryConfig.activeLearningEnabled,
      learning: learning.map((item) => {
        const queued = pendingByMailbox.get(item.mailboxId);
        return {
          ...item,
          failedCount: queued?.failedCount ?? 0,
          needsBalance: queued?.needsBalance ?? false,
          pendingCount: queued?.pendingCount ?? 0,
        };
      }),
      revision: memoryConfig.revision,
    },
    models: serializeModels(),
  };
};

const getBillingMailboxId = async (userId: string) => {
  const [record] = await db
    .select({ defaultMailboxId: user.defaultMailboxId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return record?.defaultMailboxId ?? null;
};

const assertMemoryTarget = async (
  target: MemoryTarget,
  userId: string,
  write: boolean
) => {
  if (target.scope === "user") {
    return null;
  }
  const selectedMailbox = await assertAccessibleMailbox({
    mailboxId: target.mailboxId ?? "",
    userId,
  });
  if (write && !selectedMailbox.capabilities.canManageKnowledge) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only mailbox managers can change this knowledge.",
    });
  }
  return selectedMailbox;
};

const loadTargetMemory = async (target: MemoryTarget, userId: string) =>
  target.scope === "user"
    ? await listPersonalAiMemory(userId)
    : await listMailboxAiMemory(target.mailboxId ?? "", userId);

const toUserMemoryError = (error: unknown) => {
  if (error instanceof ORPCError) {
    return error;
  }
  reportError(error, { operation: "ai-memory:request" });
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Quieter could not complete the memory request. Please try again.",
  });
};

export const aiRouter = {
  deleteMemory: protectedProcedure
    .input(memoryTargetSchema)
    .handler(async ({ context, input }) => {
      await assertMemoryTarget(input, context.userId, true);
      if (input.scope === "user") {
        await purgePersonalAiMemory(context.userId);
      } else {
        await purgeMailboxAiMemory(input.mailboxId ?? "");
      }
      return { memory: await loadTargetMemory(input, context.userId) };
    }),

  exportMemory: protectedProcedure
    .input(memoryTargetSchema)
    .handler(async ({ context, input }) => {
      await assertMemoryTarget(input, context.userId, false);
      return input.scope === "user"
        ? await exportPersonalAiMemory(context.userId)
        : await exportMailboxAiMemory(input.mailboxId ?? "");
    }),

  forgetMemory: protectedProcedure
    .input(memoryTargetSchema.extend({ memoryId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) => {
      try {
        await assertMemoryTarget(input, context.userId, true);
        return await forgetAiMemory({
          mailboxId: input.mailboxId,
          memoryId: input.memoryId,
          scope: input.scope,
          userId: context.userId,
        });
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

  interactMemory: protectedProcedure
    .input(
      memoryTargetSchema.extend({
        request: z.string().trim().min(1).max(AI_MEMORY_REQUEST_MAX_LENGTH),
      })
    )
    .handler(async ({ context, input }) => {
      try {
        const selectedMailbox = await assertMemoryTarget(
          input,
          context.userId,
          false
        );
        const allowMutations =
          selectedMailbox?.capabilities.canManageKnowledge ?? true;
        const billingMailboxId =
          input.mailboxId ?? (await getBillingMailboxId(context.userId));
        if (billingMailboxId === null || billingMailboxId.length === 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Connect a mailbox before updating AI memory.",
          });
        }
        const change = await requestAiMemoryUpdate({
          allowMutations,
          mailboxId: billingMailboxId,
          request: input.request,
          scope: input.scope,
          userId: context.userId,
        });
        return {
          answer: change.answer,
          memory: await loadTargetMemory(input, context.userId),
          summary: change.summary,
        };
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

  interpretSearchQuery: protectedProcedure
    .input(
      z.object({
        availableLabels: z
          .array(z.string().trim().min(1).max(120))
          .max(100)
          .optional(),
        mailboxId: mailboxIdSchema,
        query: z.string().trim().min(1).max(MAIL_SEARCH_QUERY_MAX_LENGTH),
      })
    )
    .handler(async ({ context, input }) => {
      const mailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      await assertCanUseAi({
        organizationId: mailbox.organizationId,
        userId: context.userId,
      });

      const requestId = randomUUID();
      const searchModel = resolveBackgroundModel();

      let parsed: ParsedMailSearch;
      try {
        parsed = await parseMailSearchWithAi({
          allowedIsValues:
            mailbox.provider === "managed"
              ? undefined
              : ["archived", "read", "unread"],
          availableLabels: input.availableLabels ?? [],
          memoryContext: serializeAiAgentContext(
            await loadAiAgentContext({
              agent: "search",
              mailboxId: mailbox.id,
              query: input.query,
              userId: context.userId,
            })
          ),
          model: searchModel,
          onUsage: (usage) => {
            void reportAiUsage({
              chatId: null,
              completionTokens: usage.completionTokens,
              costUsd: usage.costUsd,
              externalId: `search-interpret:${requestId}`,
              mailboxId: mailbox.id,
              model: searchModel,
              promptTokens: usage.promptTokens,
              promptTokensDetails: {
                cacheWriteTokens: usage.cacheWriteTokens,
                cachedTokens: usage.cachedTokens,
              },
              usageKind: "aiChat",
              userId: context.userId,
            }).catch((error: unknown) => {
              reportError(error, {
                operation: "ai:interpret-search-query:report-usage",
              });
            });
          },
          query: input.query,
        });
      } catch (error) {
        reportError(error, { operation: "ai:interpret-search-query" });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Could not interpret that search right now.",
        });
      }

      return normalizeStructuredMailSearch({
        filters: parsed.filters.filter((filter) =>
          isMailSearchFilterSupported(mailbox.provider, filter)
        ),
        text: parsed.freeText,
      });
    }),

  learnFromMail: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      try {
        return await retryMailboxMemoryBootstrap({
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

  memories: protectedProcedure
    .route({ method: "GET" })
    .input(
      memoryTargetSchema.extend({
        category: z.enum(AI_MEMORY_CATEGORIES).optional(),
        cursor: z.string().trim().min(1).max(1000).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        query: z.string().trim().max(500).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      try {
        await assertMemoryTarget(input, context.userId, false);
        return await searchAiMemory({ ...input, userId: context.userId });
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

  resetPersonalization: protectedProcedure.handler(async ({ context }) => {
    await purgePersonalAiMemory(context.userId);
    return { deleted: true };
  }),

  saveMemory: protectedProcedure
    .input(
      memoryTargetSchema
        .extend({
          category: z.enum(AI_MEMORY_CATEGORIES),
          content: z.string().trim().min(1).max(AI_MEMORY_CONTENT_MAX_LENGTH),
          correspondents: z
            .array(z.email().trim().max(320))
            .max(20)
            .default([]),
          memoryId: z.string().trim().min(1).max(200).optional(),
          version: z.number().int().positive().optional(),
        })
        .superRefine((memory, context) => {
          if (
            (memory.memoryId === undefined) !==
            (memory.version === undefined)
          ) {
            context.addIssue({
              code: "custom",
              message: "Reload this memory before saving your changes.",
              path: ["version"],
            });
          }
        })
    )
    .handler(async ({ context, input }) => {
      try {
        await assertMemoryTarget(input, context.userId, true);
        return await saveAiMemory({ ...input, userId: context.userId });
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

  settings: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => await loadSettings(context.userId)),

  suggestReply: protectedProcedure
    .input(replySuggestionInputSchema)
    .handler(requestReplySuggestion),

  updateLearningGuidance: protectedProcedure
    .input(
      memoryTargetSchema.extend({
        activeLearningEnabled: z.boolean(),
        learningPrompt: z.string().max(AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH),
        revision: z.number().int().nonnegative(),
      })
    )
    .handler(async ({ context, input }) => {
      try {
        await assertMemoryTarget(input, context.userId, true);
        return await updateAiMemoryScopeConfig({
          activeLearningEnabled: input.activeLearningEnabled,
          learningPrompt: input.learningPrompt,
          mailboxId: input.mailboxId,
          revision: input.revision,
          scope: input.scope,
          userId: context.userId,
        });
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

  updatePersonalization: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        revision: z.number().int().nonnegative(),
      })
    )
    .handler(async ({ context, input }) => {
      const current = await getPersonalAiMemoryScopeConfig(context.userId);
      const updated = await updateAiMemoryScopeConfig({
        activeLearningEnabled: input.enabled,
        learningPrompt: current.learningPrompt,
        revision: input.revision,
        scope: "user",
        userId: context.userId,
      });
      return {
        enabled: updated.activeLearningEnabled,
        revision: updated.revision,
      };
    }),
};
