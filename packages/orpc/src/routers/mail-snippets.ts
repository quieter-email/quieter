import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailSnippet } from "@quieter/database/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { assertAccessibleMailbox } from "../mailbox/service";
import { mailboxIdSchema, protectedProcedure } from "./base";

const mailSnippetIdSchema = z.string().trim().min(1);
const mailSnippetMutationSchema = z.object({
  bodyText: z
    .string()
    .min(1)
    .max(100_000)
    .refine((value) => value.trim().length > 0, {
      message: "Enter snippet text.",
    }),
  mailboxId: mailboxIdSchema,
  name: z.string().trim().min(1).max(120),
});

export const mailSnippetsRouter = {
  create: protectedProcedure
    .input(mailSnippetMutationSchema)
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      const now = new Date();
      const [created] = await db
        .insert(mailSnippet)
        .values({
          bodyText: input.bodyText,
          createdAt: now,
          id: crypto.randomUUID(),
          mailboxId: input.mailboxId,
          name: input.name,
          updatedAt: now,
        })
        .returning();

      return created;
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: mailSnippetIdSchema,
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      const [deleted] = await db
        .delete(mailSnippet)
        .where(
          and(
            eq(mailSnippet.id, input.id),
            eq(mailSnippet.mailboxId, input.mailboxId)
          )
        )
        .returning({ id: mailSnippet.id });
      if (deleted === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Snippet not found." });
      }

      return deleted;
    }),

  list: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      const snippets = await db
        .select()
        .from(mailSnippet)
        .where(eq(mailSnippet.mailboxId, input.mailboxId))
        .orderBy(desc(mailSnippet.updatedAt));

      return { snippets };
    }),

  update: protectedProcedure
    .input(mailSnippetMutationSchema.extend({ id: mailSnippetIdSchema }))
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      const [updated] = await db
        .update(mailSnippet)
        .set({
          bodyText: input.bodyText,
          name: input.name,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailSnippet.id, input.id),
            eq(mailSnippet.mailboxId, input.mailboxId)
          )
        )
        .returning();
      if (updated === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Snippet not found." });
      }

      return updated;
    }),
};
