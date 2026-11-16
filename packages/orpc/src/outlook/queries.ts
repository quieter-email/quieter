import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailMessageImportance,
  outlookMessage,
  outlookMessageFolder,
} from "@quieter/database/schema";
import type { MailCategory } from "@quieter/mail/data-plane";
import { extractMessageIds } from "@quieter/mail/message-id";
import { isMessageInMailbox } from "@quieter/mail/messages";
import type {
  ListMessagesPageResult,
  MessageInspectorResult,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/mail/messages";
import { parseRawMailSender } from "@quieter/mail/raw-message";
import { MAX_SEND_PAYLOAD_BYTES } from "@quieter/mail/send";
import {
  getOutlookAttachment,
  getOutlookMessage,
  listOutlookAttachments,
  listOutlookConversationMessages,
  listOutlookDraftMessages,
  searchOutlookMessages,
} from "@quieter/outlook/graph";
import type {
  OutlookAttachment,
  OutlookMessage,
  OutlookReadContext,
  OutlookSystemFolders,
} from "@quieter/outlook/graph";
import {
  aggregateOutlookThread,
  normalizeOutlookMessage,
} from "@quieter/outlook/messages";
import { and, desc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import { hydrateUnsubscribeStatus } from "../gmail-compose";
import { hydrateMailImportance } from "../mail-importance";
import { loadDraftReminderIntent } from "../reminders/draft-state";
import { runAuthorizedOutlookMailbox } from "./auth";
import { createOutlookProjection } from "./projection";
import { translateOutlookSearch } from "./search";
import {
  cacheOutlookMessage,
  createOutlookReadCursor,
  getOutlookCachedMessage,
  readOutlookCacheRevision,
  readOutlookReadCursor,
  readOutlookSyncState,
  reconcileOutlookThreadMembership,
} from "./storage";
import type { OutlookCacheScope } from "./storage";

type OutlookQueryInput = {
  mailboxId: string;
  signal?: AbortSignal;
  userId: string;
};
type OutlookReadCoverage = {
  complete: boolean;
  limited?: boolean;
  scope: "mailbox" | "search";
};
type OutlookListPage = ListMessagesPageResult & {
  coverage: OutlookReadCoverage;
};
type LoadedOutlookMessage = {
  contentRevision: number;
  attachments: OutlookAttachment[];
  message: OutlookMessage;
  normalized: MessageListItem;
};
const listCursorSchema = z.object({
  kind: z.literal("list"),
  messageId: z.string().min(1),
  receivedAt: z.iso.datetime(),
});
const searchCursorSchema = z
  .object({
    kind: z.literal("search"),
    limited: z.boolean(),
    offset: z.number().int().nonnegative(),
    threads: z
      .array(
        z.object({
          messageIds: z.array(z.string().min(1).max(4096)).min(1).max(1000),
          threadId: z.string().min(1).max(4096),
        })
      )
      .max(1000),
  })
  .superRefine((cursor, context) => {
    const messageIds = cursor.threads.flatMap((thread) => thread.messageIds);
    if (
      cursor.offset > cursor.threads.length ||
      messageIds.length > 1000 ||
      new Set(messageIds).size !== messageIds.length ||
      new Set(cursor.threads.map((thread) => thread.threadId)).size !==
        cursor.threads.length
    ) {
      context.addIssue({
        code: "custom",
        message: "The message page is invalid.",
      });
    }
  });
const cursorSchema = z.discriminatedUnion("kind", [
  listCursorSchema,
  searchCursorSchema,
  z.object({
    kind: z.literal("drafts"),
    listed: z.number().int().nonnegative().max(1000),
    pageUrl: z
      .string()
      .min(1)
      .max(128 * 1024),
  }),
]);

const loadOutlookReadState = async (
  scope: OutlookCacheScope,
  signal?: AbortSignal
) => {
  let state = await readOutlookSyncState(scope);
  if (state === null) {
    const { syncOutlookMailbox } = await import("./sync");
    await syncOutlookMailbox({
      mailboxId: scope.mailboxId,
      signal,
      userId: scope.userId,
    });
    state = await readOutlookSyncState(scope);
  }
  if (state === null) {
    throw new ORPCError("CONFLICT", {
      message: "This mailbox is still preparing. Refresh to continue.",
    });
  }
  return state;
};

const loadCompleteOutlookMessage = async (
  context: OutlookReadContext,
  scope: OutlookCacheScope,
  systemFolders: OutlookSystemFolders,
  messageId: string,
  selected?: OutlookMessage,
  cacheExpectation?: { changeKey: string | null; contentRevision: number }
): Promise<LoadedOutlookMessage> => {
  context.signal?.throwIfAborted();
  const expectedContentRevision =
    cacheExpectation === undefined
      ? await readOutlookCacheRevision(scope)
      : cacheExpectation.contentRevision;
  const previous =
    cacheExpectation === undefined
      ? await getOutlookCachedMessage(scope, messageId)
      : null;
  const message = selected ?? (await getOutlookMessage(context, { messageId }));
  if (
    message.id !== messageId ||
    message.body === undefined ||
    message.internetMessageHeaders === undefined
  ) {
    throw new ORPCError("BAD_GATEWAY", {
      message: "This message is incomplete. Please try again.",
    });
  }
  const attachments: OutlookAttachment[] = [];
  const seenPages = new Set<string>();
  let pageUrl: string | undefined;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await listOutlookAttachments(context, { messageId, pageUrl });
    attachments.push(...page.values);
    if (attachments.length > 1000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This message has too many attachments to open here.",
      });
    }
    pageUrl = page.nextPageUrl;
    if (pageUrl === undefined) {
      break;
    }
    if (seenPages.has(pageUrl) || pageIndex === 19) {
      throw new ORPCError("BAD_GATEWAY", {
        message:
          "The complete attachment list is unavailable. Please try again.",
      });
    }
    seenPages.add(pageUrl);
  }
  if (
    new Set(attachments.map((attachment) => attachment.id)).size !==
    attachments.length
  ) {
    throw new ORPCError("CONFLICT", {
      message: "This message changed while it was loading. Please try again.",
    });
  }
  const verified = await getOutlookMessage(context, { messageId });
  if (verified.changeKey !== message.changeKey) {
    throw new ORPCError("CONFLICT", {
      message: "This message changed while it was loading. Please try again.",
    });
  }
  const projection = createOutlookProjection({
    attachments,
    kind: "full",
    message,
  });
  const saved = await cacheOutlookMessage({
    expectedChangeKey:
      cacheExpectation === undefined
        ? (previous?.message.changeKey ?? null)
        : cacheExpectation.changeKey,
    expectedContentRevision,
    projection,
    scope,
  });
  if (!saved.cached) {
    throw new ORPCError("CONFLICT", {
      message: "This message changed while it was loading. Please try again.",
    });
  }
  const normalized = await normalizeOutlookMessage({
    attachments,
    message,
    systemFolders,
  });
  return {
    attachments,
    contentRevision: saved.contentRevision,
    message,
    normalized,
  };
};

const hydrateOutlookMessageMetadata = async (
  scope: OutlookCacheScope,
  messages: MessageListItem[]
) => {
  const [importance, unsubscribe] = await Promise.all([
    hydrateMailImportance(scope.mailboxId, messages),
    hydrateUnsubscribeStatus(scope.mailboxId, messages),
  ]);
  return importance.map((message, index) => ({
    ...message,
    ...(unsubscribe[index]?.unsubscribeStatus === undefined
      ? {}
      : { unsubscribeStatus: unsubscribe[index].unsubscribeStatus }),
  }));
};

const loadCompleteOutlookThread = async (
  context: OutlookReadContext,
  scope: OutlookCacheScope,
  systemFolders: OutlookSystemFolders,
  threadId: string
): Promise<ThreadMessagesResult> => {
  const initialRevision = await readOutlookCacheRevision(scope);
  const cached = await db
    .select({
      changeKey: outlookMessage.changeKey,
      messageId: outlookMessage.messageId,
    })
    .from(outlookMessage)
    .where(
      and(
        eq(outlookMessage.mailboxId, scope.mailboxId),
        eq(outlookMessage.threadId, threadId),
        isNull(outlookMessage.deletedAt)
      )
    )
    .limit(1001);
  if (cached.length > 1000) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This conversation is too large to open here.",
    });
  }
  const initial = new Map(cached.map((row) => [row.messageId, row.changeKey]));
  const selected = new Map<string, OutlookMessage>();
  const seenPages = new Set<string>();
  let pageUrl: string | undefined;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await listOutlookConversationMessages(context, {
      conversationId: threadId,
      pageUrl,
    });
    for (const message of page.values) {
      if (selected.has(message.id)) {
        throw new ORPCError("CONFLICT", {
          message:
            "This conversation changed while it was loading. Please try again.",
        });
      }
      selected.set(message.id, message);
    }
    if (selected.size > 1000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This conversation is too large to open here.",
      });
    }
    pageUrl = page.nextPageUrl;
    if (pageUrl === undefined) {
      break;
    }
    if (seenPages.has(pageUrl) || pageIndex === 19) {
      throw new ORPCError("BAD_GATEWAY", {
        message: "The complete conversation is unavailable. Please try again.",
      });
    }
    seenPages.add(pageUrl);
  }
  if (selected.size === 0) {
    const retired = await reconcileOutlookThreadMembership({
      expectedContentRevision: initialRevision,
      messageIds: [],
      scope,
      threadId,
    });
    if (!retired) {
      throw new ORPCError("CONFLICT", {
        message:
          "This conversation changed while it was loading. Please try again.",
      });
    }
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }
  const messages: MessageListItem[] = [];
  let contentRevision = initialRevision;
  for (const message of selected.values()) {
    const loaded = await loadCompleteOutlookMessage(
      context,
      scope,
      systemFolders,
      message.id,
      message,
      {
        changeKey: initial.get(message.id) ?? null,
        contentRevision,
      }
    );
    messages.push(loaded.normalized);
    ({ contentRevision } = loaded);
  }
  const reconciled = await reconcileOutlookThreadMembership({
    expectedContentRevision: contentRevision,
    messageIds: [...selected.keys()],
    scope,
    threadId,
  });
  if (!reconciled) {
    throw new ORPCError("CONFLICT", {
      message:
        "This conversation changed while it was loading. Please try again.",
    });
  }
  return aggregateOutlookThread({
    messages: await hydrateOutlookMessageMetadata(scope, messages),
    threadId,
  });
};

const categoryCondition = (
  category: Exclude<MailCategory, "drafts">,
  systemFolders: OutlookSystemFolders
): SQL => {
  const isEligible = sql`${outlookMessage.projection}->'message'->>'parentFolderId' not in (${systemFolders.spam}, ${systemFolders.trash})`;
  if (category === "unread") {
    return sql`not ${outlookMessage.isRead} and ${isEligible}`;
  }
  if (category === "important") {
    return sql`${isEligible} and not ${outlookMessage.isDraft} and ${outlookMessage.projection}->'message'->>'parentFolderId' <> ${systemFolders.sent} and exists (
      select 1 from ${mailMessageImportance} i inner join ${outlookMessage} c
      on c."mailboxId" = i."mailboxId" and c."messageId" = i."messageId"
      where i."mailboxId" = ${outlookMessage.mailboxId} and i."threadId" = ${outlookMessage.threadId}
      and coalesce(i."manualImportant", i."aiImportant", false) and c."deletedAt" is null and not c."isDraft"
      and c.projection->'message'->>'parentFolderId' not in (${systemFolders.sent},${systemFolders.spam},${systemFolders.trash})
      and exists (select 1 from ${outlookMessageFolder} f where f."mailboxId" = c."mailboxId" and f."messageId" = c."messageId" and f."folderId" = c.projection->'message'->>'parentFolderId')
    )`;
  }
  return sql`${outlookMessage.projection}->'message'->>'parentFolderId' = ${systemFolders[category]}`;
};

const loadSearchSnapshot = async (
  context: OutlookReadContext,
  query: string
): Promise<{
  limited: boolean;
  threads: { messageIds: string[]; threadId: string }[];
}> => {
  const messages = new Map<string, OutlookMessage>();
  const seenPages = new Set<string>();
  let pageUrl: string | undefined;
  let limited = false;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await searchOutlookMessages(context, { pageUrl, query });
    for (const message of page.values) {
      if (messages.has(message.id)) {
        throw new ORPCError("CONFLICT", {
          message: "The search changed while loading. Please try again.",
        });
      }
      messages.set(message.id, message);
    }
    if (messages.size > 1000) {
      throw new ORPCError("BAD_GATEWAY", {
        message: "The search result exceeded its supported limit.",
      });
    }
    pageUrl = page.nextPageUrl;
    if (messages.size === 1000) {
      limited = true;
      break;
    }
    if (pageUrl === undefined) {
      break;
    }
    if (seenPages.has(pageUrl) || pageIndex === 19) {
      throw new ORPCError("BAD_GATEWAY", {
        message:
          "The complete search result is unavailable. Please narrow the search.",
      });
    }
    seenPages.add(pageUrl);
  }
  const ordered = [...messages.values()].toSorted(
    (left, right) =>
      Date.parse(
        right.receivedDateTime ??
          right.sentDateTime ??
          right.createdDateTime ??
          "1970-01-01T00:00:00Z"
      ) -
        Date.parse(
          left.receivedDateTime ??
            left.sentDateTime ??
            left.createdDateTime ??
            "1970-01-01T00:00:00Z"
        ) || right.id.localeCompare(left.id)
  );
  const threads = new Map<string, string[]>();
  for (const message of ordered) {
    const ids = threads.get(message.conversationId) ?? [];
    ids.push(message.id);
    threads.set(message.conversationId, ids);
  }
  return {
    limited,
    threads: [...threads].map(([threadId, messageIds]) => ({
      messageIds,
      threadId,
    })),
  };
};

export const listOutlookThreads = async (
  input: OutlookQueryInput & {
    category: MailCategory;
    maxResults?: number;
    pageToken?: string;
    query?: string;
  }
): Promise<OutlookListPage> => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  const translated = translateOutlookSearch(input.query ?? "");
  const queryHash = createHash("sha256")
    .update(JSON.stringify({ category: input.category, query: translated }))
    .digest("hex");
  return await runAuthorizedOutlookMailbox(
    { ...input, signal },
    async (context, identity) => {
      const scope = {
        generation: identity.generation,
        mailboxId: input.mailboxId,
        userId: input.userId,
      };
      const state = await loadOutlookReadState(scope, context.signal);
      const parsedCursor =
        input.pageToken === undefined
          ? null
          : cursorSchema.safeParse(
              await readOutlookReadCursor({
                id: input.pageToken,
                queryHash,
                scope,
              })
            );
      if (parsedCursor !== null && !parsedCursor.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The message page is invalid. Refresh to continue.",
        });
      }
      const cursor = parsedCursor?.data ?? null;
      const limit = Math.min(Math.max(input.maxResults ?? 15, 1), 100);
      if (input.category === "drafts") {
        if (cursor !== null && cursor.kind !== "drafts") {
          throw new ORPCError("BAD_REQUEST", {
            message: "The message page is invalid. Refresh to continue.",
          });
        }
        const alreadyListed = cursor?.listed ?? 0;
        if (translated !== null && alreadyListed >= 1000) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "The search page is unavailable. Refine the search to continue.",
          });
        }
        const page = await listOutlookDraftMessages(context, {
          folderId: state.systemFolders.drafts,
          maxResults:
            translated === null ? limit : Math.min(limit, 1000 - alreadyListed),
          pageUrl: cursor?.pageUrl,
          query: translated ?? undefined,
        });
        const drafts: MessageListItem[] = [];
        let draftRevision = state.contentRevision;
        for (const message of page.values) {
          const previous = await getOutlookCachedMessage(scope, message.id);
          const loaded = await loadCompleteOutlookMessage(
            context,
            scope,
            state.systemFolders,
            message.id,
            message,
            {
              changeKey: previous?.message.changeKey ?? null,
              contentRevision: draftRevision,
            }
          );
          if (
            !loaded.message.isDraft ||
            loaded.message.parentFolderId !== state.systemFolders.drafts
          ) {
            throw new ORPCError("CONFLICT", {
              message:
                "This draft changed while it was loading. Refresh to continue.",
            });
          }
          drafts.push(loaded.normalized);
          draftRevision = loaded.contentRevision;
        }
        const listed =
          translated === null ? 0 : alreadyListed + page.values.length;
        const limited = translated !== null && listed >= 1000;
        return {
          coverage:
            translated === null
              ? { complete: state.coverageComplete, scope: "mailbox" }
              : {
                  complete: page.nextPageUrl === undefined && !limited,
                  limited,
                  scope: "search",
                },
          historyId: `outlook:${createHash("sha256").update(scope.mailboxId).digest("hex")}:${scope.generation}:${state.contentRevision}`,
          messages: await hydrateOutlookMessageMetadata(scope, drafts),
          nextPageToken:
            page.nextPageUrl === undefined || limited
              ? undefined
              : await createOutlookReadCursor({
                  expiresAt: new Date(Date.now() + 30 * 60_000),
                  queryHash,
                  scope,
                  state: { kind: "drafts", listed, pageUrl: page.nextPageUrl },
                }),
        };
      }
      const messages: MessageListItem[] = [];
      let nextPageToken: string | undefined;
      let coverage: OutlookReadCoverage;
      if (translated === null) {
        if (cursor !== null && cursor.kind !== "list") {
          throw new ORPCError("BAD_REQUEST", {
            message: "The message page is invalid. Refresh to continue.",
          });
        }
        const matching = db
          .selectDistinctOn([outlookMessage.threadId], {
            messageId: outlookMessage.messageId,
            receivedAt: outlookMessage.receivedAt,
            threadId: outlookMessage.threadId,
          })
          .from(outlookMessage)
          .where(
            and(
              eq(outlookMessage.mailboxId, scope.mailboxId),
              isNull(outlookMessage.deletedAt),
              categoryCondition(input.category, state.systemFolders),
              exists(
                db
                  .select({ messageId: outlookMessageFolder.messageId })
                  .from(outlookMessageFolder)
                  .where(
                    and(
                      eq(outlookMessageFolder.mailboxId, scope.mailboxId),
                      eq(
                        outlookMessageFolder.messageId,
                        outlookMessage.messageId
                      ),
                      eq(
                        outlookMessageFolder.folderId,
                        sql`${outlookMessage.projection}->'message'->>'parentFolderId'`
                      )
                    )
                  )
              )
            )
          )
          .orderBy(
            outlookMessage.threadId,
            desc(outlookMessage.receivedAt),
            desc(outlookMessage.messageId)
          )
          .as("matching_outlook_threads");
        const rows = await db
          .select()
          .from(matching)
          .where(
            cursor === null
              ? undefined
              : or(
                  lt(matching.receivedAt, new Date(cursor.receivedAt)),
                  and(
                    eq(matching.receivedAt, new Date(cursor.receivedAt)),
                    lt(matching.messageId, cursor.messageId)
                  )
                )
          )
          .orderBy(desc(matching.receivedAt), desc(matching.messageId))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        for (const row of page) {
          let thread: ThreadMessagesResult;
          try {
            thread = await loadCompleteOutlookThread(
              context,
              scope,
              state.systemFolders,
              row.threadId
            );
          } catch (error) {
            if (error instanceof ORPCError && error.code === "NOT_FOUND") {
              continue;
            }
            throw error;
          }
          const representative = thread.messages.findLast((message) =>
            isMessageInMailbox(message, input.category)
          );
          if (representative !== undefined) {
            messages.push(representative);
          }
        }
        const last = page.at(-1);
        if (rows.length > limit && last !== undefined) {
          nextPageToken = await createOutlookReadCursor({
            expiresAt: new Date(Date.now() + 30 * 60_000),
            queryHash,
            scope,
            state: {
              kind: "list",
              messageId: last.messageId,
              receivedAt: last.receivedAt.toISOString(),
            },
          });
        }
        coverage = {
          complete: state.coverageComplete,
          scope: "mailbox",
        };
      } else {
        if (cursor !== null && cursor.kind !== "search") {
          throw new ORPCError("BAD_REQUEST", {
            message: "The message page is invalid. Refresh to continue.",
          });
        }
        const snapshot = cursor ?? {
          kind: "search" as const,
          offset: 0,
          ...(await loadSearchSnapshot(context, translated)),
        };
        let { offset } = snapshot;
        let inspected = 0;
        for (
          ;
          offset < snapshot.threads.length &&
          messages.length < limit &&
          inspected < Math.max(limit * 2, 20);
          offset += 1
        ) {
          inspected += 1;
          const selected = snapshot.threads[offset];
          if (selected === undefined) {
            break;
          }
          let thread: ThreadMessagesResult;
          try {
            thread = await loadCompleteOutlookThread(
              context,
              scope,
              state.systemFolders,
              selected.threadId
            );
          } catch (error) {
            if (error instanceof ORPCError && error.code === "NOT_FOUND") {
              continue;
            }
            throw error;
          }
          const representative = thread.messages.findLast(
            (message) =>
              selected.messageIds.includes(message.id) &&
              isMessageInMailbox(message, input.category)
          );
          if (representative !== undefined) {
            messages.push(representative);
          }
        }
        if (offset < snapshot.threads.length) {
          nextPageToken = await createOutlookReadCursor({
            expiresAt: new Date(Date.now() + 30 * 60_000),
            queryHash,
            scope,
            state: { ...snapshot, offset },
          });
        }
        coverage = {
          complete: !snapshot.limited,
          limited: snapshot.limited,
          scope: "search",
        };
      }
      return {
        coverage,
        historyId: `outlook:${createHash("sha256").update(scope.mailboxId).digest("hex")}:${scope.generation}:${state.contentRevision}`,
        messages,
        nextPageToken,
      };
    }
  );
};

export const getOutlookThread = async (
  input: OutlookQueryInput & { threadId: string }
): Promise<ThreadMessagesResult> => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  return await runAuthorizedOutlookMailbox(
    { ...input, signal },
    async (context, identity) => {
      const scope = {
        generation: identity.generation,
        mailboxId: input.mailboxId,
        userId: input.userId,
      };
      const state = await loadOutlookReadState(scope, context.signal);
      return await loadCompleteOutlookThread(
        context,
        scope,
        state.systemFolders,
        input.threadId
      );
    }
  );
};

export const getOutlookMessageInspector = async (
  input: OutlookQueryInput & { messageId: string }
): Promise<MessageInspectorResult> => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  return await runAuthorizedOutlookMailbox(
    { ...input, signal },
    async (context, identity) => {
      const scope = {
        generation: identity.generation,
        mailboxId: input.mailboxId,
        userId: input.userId,
      };
      const state = await loadOutlookReadState(scope, context.signal);
      const loaded = await loadCompleteOutlookMessage(
        context,
        scope,
        state.systemFolders,
        input.messageId
      );
      return {
        ...loaded.normalized,
        headers: loaded.message.internetMessageHeaders ?? [],
      };
    }
  );
};

export const getOutlookDraft = async (
  input: OutlookQueryInput & { draftId: string }
) => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  return await runAuthorizedOutlookMailbox(
    { ...input, signal },
    async (context, identity) => {
      const scope = {
        generation: identity.generation,
        mailboxId: input.mailboxId,
        userId: input.userId,
      };
      const state = await loadOutlookReadState(scope, context.signal);
      const loaded = await loadCompleteOutlookMessage(
        context,
        scope,
        state.systemFolders,
        input.draftId
      );
      if (!loaded.message.isDraft) {
        throw new ORPCError("NOT_FOUND", {
          message: "This draft is no longer available.",
        });
      }
      const message = loaded.normalized;
      const followUpReminder = await loadDraftReminderIntent({
        draftId: input.draftId,
        mailboxId: input.mailboxId,
        userId: input.userId,
      });
      return {
        attachments: (message.attachments ?? []).map((asset) => ({
          attachmentId: asset.attachmentId,
          id: crypto.randomUUID(),
          isInline: false as const,
          mimeType: asset.mimeType,
          name: asset.fileName,
          size: asset.size,
          sourceMessageId: message.id,
        })),
        baseRevision: loaded.message.changeKey,
        bodyHtml: message.bodyHtml ?? "",
        bodyText: message.bodyText ?? "",
        draftAnchor: message.draftAnchor ?? null,
        draftId: input.draftId,
        ...(followUpReminder === undefined ? {} : { followUpReminder }),
        inlineImages: (message.inlineImages ?? []).map((asset) => ({
          attachmentId: asset.attachmentId,
          contentId: asset.contentId,
          id: crypto.randomUUID(),
          isInline: true as const,
          mimeType: asset.mimeType,
          name: asset.fileName,
          size: asset.size,
          sourceMessageId: message.id,
        })),
        lastSavedAt: Number(message.internalDate) || undefined,
        messageId: message.id,
        recipients: {
          bcc: message.bcc ?? "",
          cc: message.cc ?? "",
          to: message.to ?? "",
        },
        replyContext:
          message.draftAnchor?.seededBy !== "forward" && message.inReplyTo
            ? {
                messageHeaderId: message.inReplyTo,
                references: extractMessageIds(message.references),
                threadId: message.threadId,
              }
            : null,
        senderName: parseRawMailSender(message.from ?? "")?.name || undefined,
        subject: message.subject ?? "",
      };
    }
  );
};

export const getOutlookMessageAttachment = async (
  input: OutlookQueryInput & { attachmentId: string; messageId: string }
) => {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  return await runAuthorizedOutlookMailbox(
    { ...input, signal },
    async (context, identity) => {
      const scope = {
        generation: identity.generation,
        mailboxId: input.mailboxId,
        userId: input.userId,
      };
      const state = await loadOutlookReadState(scope, context.signal);
      const loaded = await loadCompleteOutlookMessage(
        context,
        scope,
        state.systemFolders,
        input.messageId
      );
      const metadata = loaded.attachments.find(
        (attachment) => attachment.id === input.attachmentId
      );
      if (metadata === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Attachment not found." });
      }
      const result = await getOutlookAttachment(context, {
        attachmentId: input.attachmentId,
        maxBytes: MAX_SEND_PAYLOAD_BYTES,
        messageId: input.messageId,
      });
      if (
        metadata.name !== result.attachment.name ||
        metadata.size !== result.attachment.size ||
        metadata["@odata.type"] !== result.attachment["@odata.type"]
      ) {
        throw new ORPCError("CONFLICT", {
          message: "This attachment changed while loading. Please try again.",
        });
      }
      return {
        attachmentId: metadata.id,
        file: new File([result.bytes], metadata.name, {
          type: result.contentType,
        }),
        size: result.bytes.byteLength,
      };
    }
  );
};

export const listOutlookLabels = async (input: OutlookQueryInput) =>
  await runAuthorizedOutlookMailbox(input, async (context, identity) => {
    const scope = {
      generation: identity.generation,
      mailboxId: input.mailboxId,
      userId: input.userId,
    };
    await loadOutlookReadState(scope, context.signal);
    const rows = await db
      .selectDistinct({
        name: sql<string>`jsonb_array_elements_text(${outlookMessage.projection}->'message'->'categories')`,
      })
      .from(outlookMessage)
      .where(
        and(
          eq(outlookMessage.mailboxId, scope.mailboxId),
          isNull(outlookMessage.deletedAt),
          exists(
            db
              .select({ messageId: outlookMessageFolder.messageId })
              .from(outlookMessageFolder)
              .where(
                and(
                  eq(outlookMessageFolder.mailboxId, scope.mailboxId),
                  eq(outlookMessageFolder.messageId, outlookMessage.messageId),
                  eq(
                    outlookMessageFolder.folderId,
                    sql`${outlookMessage.projection}->'message'->>'parentFolderId'`
                  )
                )
              )
          )
        )
      )
      .limit(1001);
    if (rows.length > 1000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This mailbox has too many categories to list here.",
      });
    }
    return rows
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(({ name }, position) => ({
        autoLabel: null,
        color: "gray" as const,
        description: null,
        id: `outlook-category:${encodeURIComponent(name)}`,
        inclusionCriteria: null,
        name,
        position,
        provider: "outlook" as const,
        type: "user",
        visible: true,
      }));
  });
