import { auth } from "@quietr/auth";
import { gmailMailboxState, gmailMessageCache } from "@quietr/database/schema";
import { TRPCError, initTRPC } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create();

const messageCacheSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  snippet: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  date: z.string().optional(),
  internalDate: z.string().optional(),
  senderAvatarUrl: z.string().optional(),
});

const normalizeMessageIds = (messageIds: string[]): string[] =>
  Array.from(
    new Set(
      messageIds.map((messageId) => messageId.trim()).filter((messageId) => messageId.length > 0),
    ),
  );

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = await auth.api.getSession({ headers: ctx.req.headers });
  const userId = session?.user?.id;

  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      userId,
    },
  });
});

export const appRouter = t.router({
  gmail: t.router({
    getCachedMessages: protectedProcedure
      .input(
        z.object({
          messageIds: z.array(z.string()).max(500),
        }),
      )
      .query(async ({ ctx, input }) => {
        const messageIds = normalizeMessageIds(input.messageIds);
        if (messageIds.length === 0) return [];

        const rows = await ctx.db
          .select({
            messageId: gmailMessageCache.messageId,
            threadId: gmailMessageCache.threadId,
            snippet: gmailMessageCache.snippet,
            subject: gmailMessageCache.subject,
            from: gmailMessageCache.from,
            date: gmailMessageCache.date,
            internalDateMs: gmailMessageCache.internalDateMs,
            senderAvatarUrl: gmailMessageCache.senderAvatarUrl,
          })
          .from(gmailMessageCache)
          .where(
            and(
              eq(gmailMessageCache.userId, ctx.userId),
              inArray(gmailMessageCache.messageId, messageIds),
            ),
          );

        const rowsByMessageId = new Map(rows.map((row) => [row.messageId, row]));

        return messageIds
          .map((messageId) => rowsByMessageId.get(messageId))
          .filter((row): row is (typeof rows)[number] => Boolean(row))
          .map((row) => ({
            id: row.messageId,
            threadId: row.threadId,
            snippet: row.snippet ?? undefined,
            subject: row.subject ?? undefined,
            from: row.from ?? undefined,
            date: row.date ?? undefined,
            internalDate: row.internalDateMs == null ? undefined : String(row.internalDateMs),
            senderAvatarUrl: row.senderAvatarUrl ?? undefined,
          }));
      }),
    upsertCachedMessages: protectedProcedure
      .input(
        z.object({
          messages: z.array(messageCacheSchema).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const dedupedMessagesById = new Map<string, z.infer<typeof messageCacheSchema>>();

        for (const message of input.messages) {
          const normalizedMessageId = message.id.trim();
          if (!normalizedMessageId) continue;

          dedupedMessagesById.set(normalizedMessageId, {
            ...message,
            id: normalizedMessageId,
          });
        }

        const dedupedMessages = Array.from(dedupedMessagesById.values());
        if (dedupedMessages.length === 0) return { saved: 0 };

        const now = new Date();
        const rows = dedupedMessages.map((message) => ({
          id: `${ctx.userId}:${message.id}`,
          userId: ctx.userId,
          messageId: message.id,
          threadId: message.threadId,
          snippet: message.snippet ?? null,
          subject: message.subject ?? null,
          from: message.from ?? null,
          date: message.date ?? null,
          internalDateMs: message.internalDate ? Number(message.internalDate) : null,
          senderAvatarUrl: message.senderAvatarUrl ?? null,
          createdAt: now,
          updatedAt: now,
        }));

        await ctx.db
          .insert(gmailMessageCache)
          .values(rows)
          .onConflictDoUpdate({
            target: [gmailMessageCache.userId, gmailMessageCache.messageId],
            set: {
              threadId: sql`excluded."threadId"`,
              snippet: sql`excluded."snippet"`,
              subject: sql`excluded."subject"`,
              from: sql`excluded."from"`,
              date: sql`excluded."date"`,
              internalDateMs: sql`excluded."internalDateMs"`,
              senderAvatarUrl: sql`excluded."senderAvatarUrl"`,
              updatedAt: now,
            },
          });

        await ctx.db
          .insert(gmailMailboxState)
          .values({
            userId: ctx.userId,
            lastSyncAt: now,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: gmailMailboxState.userId,
            set: {
              lastSyncAt: now,
              lastError: null,
              updatedAt: now,
            },
          });

        return { saved: rows.length };
      }),
  }),
});

export type AppRouter = typeof appRouter;
