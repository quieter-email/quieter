import { db } from "@quieter/database/client";
import { semanticIndexRequest } from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { assertAccessibleMailbox } from "../mailbox/service";
import {
  requestSemanticIndex,
  requestFullMailSemanticIndex,
} from "../semantic-index-request";
import { searchSemanticHistory } from "../semantic-search";
import { mailboxIdSchema, protectedProcedure } from "./base";

const readPreparation = async (input: {
  mailboxId: string;
  userId: string;
  kind: "chat" | "mail";
}) => {
  const selectedMailbox = await assertAccessibleMailbox(input);
  const [index] = await db
    .select({
      completedAt: semanticIndexRequest.completedAt,
      importRequestedAt: semanticIndexRequest.mailImportRequestedAt,
      importedAt: semanticIndexRequest.mailImportedAt,
      indexedSources: semanticIndexRequest.indexedSources,
      lastError: semanticIndexRequest.lastError,
      totalSources: semanticIndexRequest.totalSources,
    })
    .from(semanticIndexRequest)
    .where(
      and(
        eq(semanticIndexRequest.userId, input.userId),
        eq(semanticIndexRequest.mailboxId, input.mailboxId),
        eq(semanticIndexRequest.kind, input.kind)
      )
    )
    .limit(1);
  return {
    active: index !== undefined,
    canImport: selectedMailbox.provider === "gmail",
    complete: index !== undefined && index.completedAt !== null,
    importComplete: index !== undefined && index.importedAt !== null,
    importRequested: index !== undefined && index.importRequestedAt !== null,
    indexedSources: index?.indexedSources ?? 0,
    totalSources: index?.totalSources ?? 0,
    waiting: index !== undefined && index.lastError !== null,
  };
};

export const searchRouter = {
  history: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["chat", "mail"]),
        mailboxId: mailboxIdSchema,
        query: z.string().trim().min(1).max(2000),
      })
    )
    .handler(async ({ context, input, signal }) => {
      await requestSemanticIndex({ ...input, userId: context.userId });
      const result = await searchSemanticHistory({
        ...input,
        signal,
        userId: context.userId,
      });
      return {
        ...result,
        preparation: await readPreparation({
          ...input,
          userId: context.userId,
        }),
      };
    }),
  pause: protectedProcedure
    .input(
      z.object({ kind: z.enum(["chat", "mail"]), mailboxId: mailboxIdSchema })
    )
    .handler(async ({ context, input }) => {
      await assertAccessibleMailbox({ ...input, userId: context.userId });
      await db
        .delete(semanticIndexRequest)
        .where(
          and(
            eq(semanticIndexRequest.userId, context.userId),
            eq(semanticIndexRequest.mailboxId, input.mailboxId),
            eq(semanticIndexRequest.kind, input.kind)
          )
        );
      return { paused: true };
    }),
  prepareMail: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      await requestFullMailSemanticIndex({ ...input, userId: context.userId });
      return { requested: true };
    }),
  status: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({ kind: z.enum(["chat", "mail"]), mailboxId: mailboxIdSchema })
    )
    .handler(
      async ({ context, input }) =>
        await readPreparation({ ...input, userId: context.userId })
    ),
};
