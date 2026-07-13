import { ORPCError } from "@orpc/server";
import {
  chatModelSchema,
  defaultAutoLabelModel,
  defaultUsefulDetailModel,
} from "@quieter/ai/chat-models";
import {
  sanitizeUserAiContextMarkdown,
  USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH,
} from "@quieter/ai/user-ai-context";
import { db } from "@quieter/database/client";
import { userAiContext } from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { protectedProcedure } from "./base";

const serializeSettings = (record: typeof userAiContext.$inferSelect | undefined) => {
  const autoLabelModel = chatModelSchema.safeParse(record?.autoLabelModel);
  const usefulDetailModel = chatModelSchema.safeParse(record?.usefulDetailModel);

  return {
    memory: {
      lastEditedAt: record?.lastEditedAt ?? null,
      markdown: record?.markdown ?? "",
      revision: record?.revision ?? 0,
    },
    models: {
      autoLabel: autoLabelModel.success ? autoLabelModel.data : defaultAutoLabelModel,
      usefulDetail: usefulDetailModel.success ? usefulDetailModel.data : defaultUsefulDetailModel,
    },
  };
};

export const aiRouter = {
  settings: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
    const [record] = await db
      .select()
      .from(userAiContext)
      .where(eq(userAiContext.userId, context.userId))
      .limit(1);

    return serializeSettings(record);
  }),

  updateModels: protectedProcedure
    .input(
      z.object({
        autoLabel: chatModelSchema,
        usefulDetail: chatModelSchema,
      }),
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
          userId: context.userId,
          usefulDetailModel: input.usefulDetail,
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

      return serializeSettings(record).models;
    }),

  updateMemory: protectedProcedure
    .input(
      z.object({
        markdown: z.string().max(USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH),
        revision: z.number().int().nonnegative(),
      }),
    )
    .handler(async ({ context, input }) => {
      const markdown = sanitizeUserAiContextMarkdown(input.markdown);
      const now = new Date();

      const [record] =
        input.revision === 0
          ? await db
              .insert(userAiContext)
              .values({
                createdAt: now,
                id: randomUUID(),
                lastEditedAt: now,
                markdown,
                updatedAt: now,
                userId: context.userId,
              })
              .onConflictDoNothing({ target: userAiContext.userId })
              .returning()
          : await db
              .update(userAiContext)
              .set({
                lastEditedAt: now,
                markdown,
                revision: sql`${userAiContext.revision} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(userAiContext.userId, context.userId),
                  eq(userAiContext.revision, input.revision),
                ),
              )
              .returning();

      if (!record) {
        throw new ORPCError("CONFLICT", {
          message: "AI memory changed while you were editing it. Review the latest version.",
        });
      }

      return serializeSettings(record).memory;
    }),
};
