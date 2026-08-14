import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { AI_MEMORY_REQUEST_MAX_LENGTH } from "@quieter/ai/ai-memory";
import {
  chatModelSchema,
  defaultAutoLabelModel,
  defaultUsefulDetailModel,
} from "@quieter/ai/chat-models";
import { db } from "@quieter/database/client";
import { user, userAiContext } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  AI_MEMORY_LEARNING_PROMPT_MAX_LENGTH,
  exportMailboxAiMemory,
  exportPersonalAiMemory,
  forgetAiMemory,
  getPersonalAiMemoryScopeConfig,
  listMailboxAiMemory,
  listPersonalAiMemory,
  purgeMailboxAiMemory,
  purgePersonalAiMemory,
  requestAiMemoryUpdate,
  undoAiMemoryChange,
  updateAiMemoryScopeConfig,
} from "../ai-memory";
import { assertAccessibleMailbox } from "../mailbox/service";
import { protectedProcedure } from "./base";

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

const serializeModels = (
  record: typeof userAiContext.$inferSelect | undefined
) => {
  const autoLabelModel = chatModelSchema.safeParse(record?.autoLabelModel);
  const usefulDetailModel = chatModelSchema.safeParse(
    record?.usefulDetailModel
  );
  return {
    autoLabel: autoLabelModel.success
      ? autoLabelModel.data
      : defaultAutoLabelModel,
    usefulDetail: usefulDetailModel.success
      ? usefulDetailModel.data
      : defaultUsefulDetailModel,
  };
};

const loadSettings = async (userId: string) => {
  const [[record], memoryConfig] = await Promise.all([
    db
      .select()
      .from(userAiContext)
      .where(eq(userAiContext.userId, userId))
      .limit(1),
    getPersonalAiMemoryScopeConfig(userId),
  ]);
  return {
    memory: {
      enabled: memoryConfig.activeLearningEnabled,
      revision: memoryConfig.revision,
    },
    models: serializeModels(record),
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

const toUserMemoryError = (error: unknown) =>
  error instanceof ORPCError
    ? error
    : new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error && error.message
            ? error.message
            : "Quieter could not safely update AI memory. Nothing changed.",
      });

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
      await assertMemoryTarget(input, context.userId, true);
      const change = await forgetAiMemory({
        mailboxId: input.mailboxId,
        memoryId: input.memoryId,
        scope: input.scope,
        userId: context.userId,
      });
      if (!change) {
        throw new ORPCError("NOT_FOUND", { message: "Memory not found." });
      }
      return {
        memory: await loadTargetMemory(input, context.userId),
        summary: change.summary,
      };
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
          throw new Error("Connect a mailbox before updating AI memory.");
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

  resetPersonalization: protectedProcedure.handler(async ({ context }) => {
    await purgePersonalAiMemory(context.userId);
    return { deleted: true };
  }),

  settings: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => await loadSettings(context.userId)),

  undoMemoryChange: protectedProcedure
    .input(memoryTargetSchema.extend({ changeSetId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) => {
      try {
        await assertMemoryTarget(input, context.userId, true);
        const change = await undoAiMemoryChange({
          changeSetId: input.changeSetId,
          mailboxId: input.mailboxId,
          scope: input.scope,
          userId: context.userId,
        });
        return {
          memory: await loadTargetMemory(input, context.userId),
          summary: change.summary,
        };
      } catch (error) {
        throw toUserMemoryError(error);
      }
    }),

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

  updateModels: protectedProcedure
    .input(
      z.object({
        autoLabel: chatModelSchema,
        usefulDetail: chatModelSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      const [record] = await db
        .insert(userAiContext)
        .values({
          autoLabelModel: input.autoLabel,
          createdAt: now,
          id: randomUUID(),
          lastEditedAt: now,
          markdown: "",
          updatedAt: now,
          usefulDetailModel: input.usefulDetail,
          userId: context.userId,
        })
        .onConflictDoUpdate({
          set: {
            autoLabelModel: input.autoLabel,
            updatedAt: now,
            usefulDetailModel: input.usefulDetail,
          },
          target: userAiContext.userId,
        })
        .returning();
      return serializeModels(record);
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
