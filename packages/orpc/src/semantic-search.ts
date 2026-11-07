import { ORPCError } from "@orpc/server";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import {
  embedSearchTexts,
  SEARCH_EMBEDDING_MODEL,
  SEARCH_EMBEDDING_MODEL_KEY,
} from "@quieter/ai/search-embeddings";
import { reportAiUsage } from "@quieter/billing";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import {
  aiMemory,
  chat,
  chatMessage,
  gmailCapturedMessage,
  managedMailMessage,
  semanticEmbedding,
  semanticSearchLease,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { normalizeCapturedMailMetadata } from "./mail-capture-normalization";
import { assertAccessibleMailbox } from "./mailbox/service";
import { semanticSourceQuery } from "./semantic-search-sources";
import type { SemanticSearchScope } from "./semantic-search-sources";

export type SemanticSearchCoverage = {
  indexedSources: number;
  totalSources: number;
  complete: boolean;
};

type SemanticSearchInput = SemanticSearchScope & {
  query: string;
  signal?: AbortSignal;
};

const chunkSchema = z.object({
  chunkIndex: z.coerce.number().int().nonnegative(),
  content: z.string(),
  sourceKey: z.string(),
  sourceRevision: z.string(),
});
const coverageSchema = z.object({
  indexedSources: z.coerce.number().int().nonnegative(),
  totalSources: z.coerce.number().int().nonnegative(),
});
const memoryMatchSchema = z.object({
  id: z.string(),
  similarity: z.coerce.number(),
  version: z.coerce.number().int(),
});
const historyMatchSchema = z.discriminatedUnion("kind", [
  z.object({
    chatId: z.string(),
    kind: z.literal("chat"),
    messageId: z.string(),
    snippet: z.string(),
    title: z.string(),
    updatedAt: z.coerce.date().transform((value) => value.toISOString()),
  }),
  z.object({
    kind: z.literal("mail"),
    messageId: z.string(),
    snippet: z.string(),
    threadId: z.string(),
    title: z.string(),
    updatedAt: z.coerce.date().transform((value) => value.toISOString()),
  }),
]);

const readCoverage = async (
  sourceQuery: ReturnType<typeof semanticSourceQuery>
) => {
  const rows = await db.execute(sql`with sources as (${sourceQuery})
    select count(*) as "totalSources",
      count(*) filter (where sources."sourceRevision" is not null and
        (select count(*) from ${semanticEmbedding} e
          where e."sourceKey" = sources."sourceKey" and e.model = ${SEARCH_EMBEDDING_MODEL_KEY}
            and e."sourceRevision" = sources."sourceRevision") = ceil(char_length(content)::numeric / 2000)) as "indexedSources"
      from sources`);
  const [coverage] = z.array(coverageSchema).parse(rows);
  return {
    complete: coverage?.indexedSources === coverage?.totalSources,
    indexedSources: coverage?.indexedSources ?? 0,
    totalSources: coverage?.totalSources ?? 0,
  };
};

export const readSemanticSearchCoverage = async (
  input: SemanticSearchScope
): Promise<SemanticSearchCoverage> => {
  const mailbox = await assertAccessibleMailbox(input);
  const coverage = await readCoverage(
    semanticSourceQuery(input, mailbox.provider)
  );
  await assertAccessibleMailbox(input);
  return coverage;
};

const runSemanticPreparation = async (
  input: SemanticSearchScope & {
    signal?: AbortSignal;
    operation: { kind: "index" } | { kind: "search"; query: string };
  }
) => {
  input.signal?.throwIfAborted();
  const mailbox = await assertAccessibleMailbox(input);
  const sourceQuery = semanticSourceQuery(input, mailbox.provider);
  const query =
    input.operation.kind === "search"
      ? input.operation.query.trim().slice(0, 2000).toWellFormed()
      : null;
  const initialCoverage = await readCoverage(sourceQuery);
  if (
    query === "" ||
    initialCoverage.totalSources === 0 ||
    (query === null && initialCoverage.complete)
  ) {
    return { coverage: initialCoverage, memoryMatches: [], queryVector: null };
  }
  const token = crypto.randomUUID();
  const now = new Date();
  const lease = await db
    .insert(semanticSearchLease)
    .values({
      expiresAt: new Date(now.getTime() + 60_000),
      mailboxId: input.mailboxId,
      token,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: { expiresAt: new Date(now.getTime() + 60_000), token },
      setWhere: lt(semanticSearchLease.expiresAt, now),
      target: [semanticSearchLease.userId, semanticSearchLease.mailboxId],
    })
    .returning({ token: semanticSearchLease.token });
  const ownsPreparation = lease.length > 0;
  if (!ownsPreparation && input.operation.kind === "index") {
    throw new ORPCError("CONFLICT", {
      message: "Search is already being prepared. Try again shortly.",
    });
  }
  try {
    if (ownsPreparation && input.kind === "mail") {
      await normalizeCapturedMailMetadata(input);
    }
    const pending = ownsPreparation
      ? z
          .array(chunkSchema)
          .parse(
            await db.execute(sql`with sources as (${sourceQuery})
        select sources."sourceKey", sources."sourceRevision", chunks."chunkIndex",
          substring(content from chunks."chunkIndex" * 2000 + 1 for 2000) as content
        from sources cross join lateral generate_series(0, ceil(char_length(content)::numeric / 2000)::integer - 1) as chunks("chunkIndex")
        where sources."sourceRevision" is not null and not exists (select 1 from ${semanticEmbedding} e
          where e."sourceKey" = sources."sourceKey" and e.model = ${SEARCH_EMBEDDING_MODEL_KEY}
            and e."sourceRevision" = sources."sourceRevision" and e."chunkIndex" = chunks."chunkIndex")
        order by sources."updatedAt" desc, sources."sourceKey", chunks."chunkIndex" limit 16`)
          )
          .toSorted(
            (left, right) =>
              left.sourceKey.localeCompare(right.sourceKey) ||
              left.chunkIndex - right.chunkIndex
          )
      : [];
    if (pending.length === 0 && query === null) {
      return {
        coverage: await readCoverage(sourceQuery),
        memoryMatches: [],
        queryVector: null,
      };
    }
    const externalId = `memory-recall:${crypto.randomUUID()}`;
    const billing = await createMailboxAiBillingContext({
      externalId,
      mailboxId: input.mailboxId,
      usageKind: "aiMemory",
      userId: input.userId,
    });
    let usage: AiUsageReport | undefined;
    let vectors: number[][];
    try {
      vectors = await embedSearchTexts({
        billing,
        onUsage: (value) => {
          usage = value;
        },
        signal: input.signal,
        values: [
          ...pending.map((chunk) => chunk.content),
          ...(query === null ? [] : [query]),
        ],
      });
    } finally {
      if (usage !== undefined) {
        try {
          await reportAiUsage({
            completionTokens: usage.completionTokens,
            costUsd: usage.costUsd,
            externalId,
            mailboxId: input.mailboxId,
            model: SEARCH_EMBEDDING_MODEL,
            promptTokens: usage.promptTokens,
            usageKind: "aiMemory",
            userId: input.userId,
          });
        } catch {
          reportError(new Error("Search usage could not be recorded."), {
            operation: "semantic-search:usage",
          });
        }
      }
    }
    input.signal?.throwIfAborted();
    await assertAccessibleMailbox(input);
    const queryVector = query === null ? null : vectors.at(-1);
    if (
      queryVector === undefined ||
      vectors.length !== pending.length + (query === null ? 0 : 1)
    ) {
      throw new Error("Search preparation did not return all embeddings.");
    }
    if (pending.length > 0) {
      await db.transaction(async (tx) => {
        const [activeLease] = await tx
          .select({ token: semanticSearchLease.token })
          .from(semanticSearchLease)
          .where(
            and(
              eq(semanticSearchLease.userId, input.userId),
              eq(semanticSearchLease.mailboxId, input.mailboxId),
              eq(semanticSearchLease.token, token),
              gt(semanticSearchLease.expiresAt, new Date())
            )
          )
          .for("update");
        if (activeLease === undefined) {
          return;
        }
        for (const [index, chunk] of pending.entries()) {
          const vector = vectors[index];
          if (vector === undefined) {
            throw new Error("A search chunk embedding is missing.");
          }
          const [sourceKind, sourceId, sourceMailboxId] = z
            .tuple([
              z.enum(["memory", "chat", "gmail", "managed"]),
              z.string(),
              z.string(),
            ])
            .parse(JSON.parse(chunk.sourceKey));
          switch (sourceKind) {
            case "memory": {
              await tx
                .select({ id: aiMemory.id })
                .from(aiMemory)
                .where(
                  and(
                    eq(aiMemory.id, sourceId),
                    eq(aiMemory.userId, input.userId)
                  )
                )
                .for("share");
              break;
            }
            case "chat": {
              await tx
                .select({ id: chatMessage.id })
                .from(chatMessage)
                .innerJoin(chat, eq(chat.id, chatMessage.chatId))
                .where(
                  and(
                    eq(chatMessage.id, sourceId),
                    eq(chat.userId, input.userId),
                    eq(chat.mailboxId, input.mailboxId)
                  )
                )
                .for("share");
              break;
            }
            case "gmail": {
              await tx
                .select({ id: gmailCapturedMessage.messageId })
                .from(gmailCapturedMessage)
                .where(
                  and(
                    eq(gmailCapturedMessage.messageId, sourceId),
                    eq(gmailCapturedMessage.mailboxId, sourceMailboxId),
                    eq(gmailCapturedMessage.mailboxId, input.mailboxId)
                  )
                )
                .for("share");
              break;
            }
            case "managed": {
              await tx
                .select({ id: managedMailMessage.id })
                .from(managedMailMessage)
                .where(
                  and(
                    eq(managedMailMessage.id, sourceId),
                    eq(managedMailMessage.mailboxId, input.mailboxId)
                  )
                )
                .for("share");
              break;
            }
            default: {
              const exhaustive: never = sourceKind;
              throw new Error("Unknown search source.", { cause: exhaustive });
            }
          }
          await tx.execute(sql`with sources as (${sourceQuery})
            delete from ${semanticEmbedding} e using sources
              where e."sourceKey" = sources."sourceKey" and e."sourceKey" = ${chunk.sourceKey}
                and e.model = ${SEARCH_EMBEDDING_MODEL_KEY} and e."sourceRevision" <> sources."sourceRevision"`);
          await tx.execute(sql`with sources as (${sourceQuery})
            insert into ${semanticEmbedding} ("sourceKey", model, "chunkIndex", "sourceRevision", "searchText", embedding, "createdAt", "memoryId", "chatMessageId", "gmailMailboxId", "gmailMessageId", "managedMessageId")
            select "sourceKey", ${SEARCH_EMBEDDING_MODEL_KEY}, ${chunk.chunkIndex}, "sourceRevision", ${chunk.content}, ${JSON.stringify(vector)}::vector, now(),
              "memoryId", "chatMessageId", "gmailMailboxId", "gmailMessageId", "managedMessageId"
              from sources where "sourceKey" = ${chunk.sourceKey} and "sourceRevision" = ${chunk.sourceRevision}
            on conflict ("sourceKey", model, "chunkIndex") do update set
              "sourceRevision" = excluded."sourceRevision", "searchText" = excluded."searchText", embedding = excluded.embedding, "createdAt" = excluded."createdAt"`);
        }
      });
    }
    await assertAccessibleMailbox(input);
    const memoryMatches =
      input.kind === "memory" && queryVector !== null
        ? z.array(memoryMatchSchema).parse(
            await db.execute(sql`with sources as (${sourceQuery})
          select sources.id, sources.version, max(1 - (e.embedding <=> ${JSON.stringify(queryVector)}::vector)) as similarity
          from sources inner join ${semanticEmbedding} e on e."sourceKey" = sources."sourceKey"
            and e."sourceRevision" = sources."sourceRevision" and e.model = ${SEARCH_EMBEDDING_MODEL_KEY}
          group by sources.id, sources.version having max(1 - (e.embedding <=> ${JSON.stringify(queryVector)}::vector)) >= 0.3
          order by similarity desc, sources.id limit 40`)
          )
        : [];
    return {
      coverage: await readCoverage(sourceQuery),
      memoryMatches,
      queryVector,
    };
  } finally {
    if (ownsPreparation) {
      await db
        .delete(semanticSearchLease)
        .where(
          and(
            eq(semanticSearchLease.userId, input.userId),
            eq(semanticSearchLease.mailboxId, input.mailboxId),
            eq(semanticSearchLease.token, token)
          )
        );
    }
  }
};

export const prepareSemanticSearch = async (input: SemanticSearchInput) =>
  await runSemanticPreparation({
    ...input,
    operation: { kind: "search", query: input.query },
  });

export const indexSemanticSources = async (
  input: SemanticSearchScope & { signal?: AbortSignal }
) => {
  const prepared = await runSemanticPreparation({
    ...input,
    operation: { kind: "index" },
  });
  return prepared.coverage;
};

export const searchSemanticHistory = async (
  input: SemanticSearchInput & { kind: "chat" | "mail" }
) => {
  const prepared = await prepareSemanticSearch(input);
  const mailbox = await assertAccessibleMailbox(input);
  const sources = semanticSourceQuery(input, mailbox.provider);
  const vector = prepared.queryVector;
  if (vector === null) {
    return {
      coverage: prepared.coverage,
      items: [],
      retainedOnly: input.kind === "mail" && mailbox.provider === "gmail",
    };
  }
  const terms = [...input.query.matchAll(/[\p{L}\p{N}]+/gu)]
    .slice(0, 32)
    .map(([term]) => JSON.stringify(term));
  const nativeText =
    terms.length > 0
      ? sql`select sources."sourceKey", e."chunkIndex", tin.score(e.ctid) as score
        from ${semanticEmbedding} e inner join sources on e."sourceKey" = sources."sourceKey"
          and e."sourceRevision" = sources."sourceRevision" and e.model = ${SEARCH_EMBEDDING_MODEL_KEY}
        where e."searchText" ==> ${`[${terms.join(" ")}]`} order by score desc, sources."sourceKey", e."chunkIndex" limit 80`
      : sql`select null::text as "sourceKey", 0::integer as "chunkIndex", 0::double precision as score where false`;
  const matches = await db.execute(sql`with sources as (${sources}),
    native_text as (${nativeText}), native_best as (
      select distinct on ("sourceKey") "sourceKey", "chunkIndex", score
      from native_text order by "sourceKey", score desc, "chunkIndex"
    ), native_ranked as (
      select "sourceKey", "chunkIndex", row_number() over (order by score desc, "sourceKey") as rank
      from native_best
    ), fallback_text as (
      select sources."sourceKey", 0::integer as "chunkIndex",
        ts_rank_cd(to_tsvector('simple', title || ' ' || content), websearch_to_tsquery('simple', ${input.query})) as score
      from sources where to_tsvector('simple', title || ' ' || content) @@ websearch_to_tsquery('simple', ${input.query})
        and not exists (select 1 from native_text where native_text."sourceKey" = sources."sourceKey")
    ), fallback_ranked as (
      select "sourceKey", "chunkIndex", row_number() over (order by score desc, "sourceKey") as rank
      from fallback_text order by score desc, "sourceKey" limit 40
    ), lexical as (
      select "sourceKey", "chunkIndex", rank from native_ranked
      union all select "sourceKey", "chunkIndex", rank from fallback_ranked
    ), best_vectors as (
      select distinct on (sources."sourceKey") sources."sourceKey", e."chunkIndex",
        e.embedding <=> ${JSON.stringify(vector)}::vector as distance
      from sources inner join ${semanticEmbedding} e on e."sourceKey" = sources."sourceKey"
        and e."sourceRevision" = sources."sourceRevision" and e.model = ${SEARCH_EMBEDDING_MODEL_KEY}
      order by sources."sourceKey", distance, e."chunkIndex"
    ), vectors as (
      select "sourceKey", "chunkIndex", row_number() over (order by distance, "sourceKey") as rank
      from best_vectors where 1 - distance >= 0.3 order by distance, "sourceKey" limit 40
    ), combined as (
      select "sourceKey", "chunkIndex", 1.0 / (60 + rank) as score from lexical
      union all select "sourceKey", "chunkIndex", 1.0 / (60 + rank) as score from vectors
    ), ranked as (
      select "sourceKey", sum(score) as score, (array_agg("chunkIndex" order by score desc, "chunkIndex"))[1] as "chunkIndex"
      from combined group by "sourceKey"
    ), hits as (
      select sources.*, ranked.score, substring(content from ranked."chunkIndex" * 2000 + 1 for 400) as snippet,
        row_number() over (partition by coalesce("chatId", "threadId", id) order by ranked.score desc, sources."updatedAt" desc, sources.id) as "groupRank"
      from sources inner join ranked using ("sourceKey")
    )
    select case when kind = 'chat' then 'chat' else 'mail' end as kind,
      "chatId", id as "messageId", "threadId", title, snippet, "updatedAt"
    from hits where "groupRank" = 1 order by score desc, "updatedAt" desc, "sourceKey" limit 30`);
  await assertAccessibleMailbox(input);
  return {
    coverage: prepared.coverage,
    items: z.array(historyMatchSchema).parse(matches),
    retainedOnly: input.kind === "mail" && mailbox.provider === "gmail",
  };
};
