import {
  gmailLabel,
  mailSyncEntity,
  mailSyncProviderState,
  mailSyncStream,
} from "@quieter/database/schema";
import {
  getGmailProfile,
  getGmailMessageCount,
  getThreadWithDetails,
  isGmailServiceError,
  listGmailSyncHistoryPage,
  listGmailSyncThreads,
  listLabels,
} from "@quieter/gmail";
import type { MailLabelListItem } from "@quieter/mail/messages";
import type { SyncMessage } from "@quieter/sync";
import { and, eq, inArray, isNull, isNotNull, ne, or } from "drizzle-orm";

import { prepareSyncMessage } from "../body-store";
import type { SyncBodyStore } from "../body-store";
import { projectSavedViews } from "../metadata";
import type { SyncRepository, SyncTransaction } from "../repository";
import { assertProviderLease, withProviderLease } from "./lease";

export type GmailSyncProvider = {
  profile: () => ReturnType<typeof getGmailProfile>;
  history: (
    cursor: string,
    pageToken?: string
  ) => ReturnType<typeof listGmailSyncHistoryPage>;
  threads: (pageToken?: string) => ReturnType<typeof listGmailSyncThreads>;
  thread: (threadId: string) => ReturnType<typeof getThreadWithDetails>;
  labels: () => Promise<MailLabelListItem[]>;
  unreadCount: () => Promise<number>;
};

export const gmailSyncProvider = (
  accessToken: string,
  signal?: AbortSignal
): GmailSyncProvider => ({
  history: async (cursor, pageToken) =>
    await listGmailSyncHistoryPage(accessToken, {
      pageToken,
      signal,
      startHistoryId: cursor,
    }),
  labels: async () => await listLabels(accessToken, signal),
  profile: async () => await getGmailProfile(accessToken, signal),
  thread: async (threadId) =>
    await getThreadWithDetails(accessToken, threadId, signal),
  threads: async (pageToken) =>
    await listGmailSyncThreads(accessToken, {
      maxResults: 10,
      pageToken,
      signal,
    }),
  unreadCount: async () =>
    (await getGmailMessageCount(accessToken, {
      accurateUpTo: 99,
      countBy: "threads",
      mailbox: "unread",
      query: "-in:spam -in:trash",
      signal,
    })) ?? 0,
});

export const projectGmailThreads = async (
  context: SyncTransaction,
  threads: ReadonlyMap<string, SyncMessage[]>,
  providerGeneration?: string
) => {
  const { database, mailboxId, put } = context;
  for (const [threadId, messages] of threads) {
    const previous = await database
      .select({ id: mailSyncEntity.entityId })
      .from(mailSyncEntity)
      .where(
        and(
          eq(mailSyncEntity.mailboxId, mailboxId),
          eq(mailSyncEntity.kind, "message"),
          eq(mailSyncEntity.threadId, threadId)
        )
      );
    const currentIds = new Set(messages.map((message) => message.id));
    for (const message of messages) {
      put({
        data: { kind: "message", value: message },
        id: message.id,
        kind: "message",
        providerGeneration,
        sortAt: new Date(Number(message.internalDate ?? 0)),
        threadId,
      });
    }
    for (const old of previous) {
      if (!currentIds.has(old.id)) {
        put({ data: null, id: old.id, kind: "message", threadId });
      }
    }
    const ordered = messages.toSorted(
      (a, b) =>
        Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0) ||
        a.id.localeCompare(b.id)
    );
    const latest = ordered.at(-1);
    put({
      data:
        latest === undefined
          ? null
          : {
              kind: "thread",
              value: {
                attachmentCount: messages.reduce(
                  (count, message) => count + message.attachments.length,
                  0
                ),
                id: threadId,
                isUnread: messages.some((message) => message.isUnread),
                labelIds: [
                  ...new Set(messages.flatMap((message) => message.labelIds)),
                ].toSorted(),
                latest,
                messageCount: messages.length,
                messageIds: ordered.map((message) => message.id),
              },
            },
      id: threadId,
      kind: "thread",
      providerGeneration,
      sortAt:
        latest === undefined
          ? undefined
          : new Date(Number(latest.internalDate ?? 0)),
      threadId,
    });
  }
};

export const fetchGmailSyncThreads = async (
  provider: GmailSyncProvider,
  store: SyncBodyStore,
  mailboxId: string,
  ids: string[]
) => {
  const results = new Map<string, SyncMessage[]>();
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 4) {
    await Promise.all(
      unique.slice(offset, offset + 4).map(async (threadId) => {
        try {
          const thread = await provider.thread(threadId);
          const messages: SyncMessage[] = [];
          for (const message of thread.messages) {
            messages.push(await prepareSyncMessage(store, mailboxId, message));
          }
          results.set(threadId, messages);
        } catch (error) {
          if (isGmailServiceError(error) && error.status === 404) {
            results.set(threadId, []);
          } else {
            throw error;
          }
        }
      })
    );
  }
  return results;
};

export const synchronizeGmail = async (
  repository: SyncRepository,
  store: SyncBodyStore,
  mailboxId: string,
  provider: GmailSyncProvider
) =>
  await withProviderLease(repository, mailboxId, async (state, leaseId) => {
    const generation = state.inventoryGeneration ?? crypto.randomUUID();
    const initialProfile =
      state.cursor === null ? await provider.profile() : null;
    const cursor = state.cursor ?? initialProfile?.historyId;
    if (!cursor) {
      throw new Error(
        "The mailbox provider did not return a history checkpoint."
      );
    }
    const history = await provider.history(
      cursor,
      state.historyPageToken ?? undefined
    );
    if (history.expired) {
      const profile = await provider.profile();
      if (!profile.historyId) {
        throw new Error("The mailbox history checkpoint is unavailable.");
      }
      await repository.database
        .update(mailSyncProviderState)
        .set({
          bootstrapCursor: profile.historyId,
          cursor: profile.historyId,
          historyPageToken: null,
          inventoryGeneration: crypto.randomUUID(),
          pageToken: null,
          phase: "repair",
        })
        .where(
          and(
            eq(mailSyncProviderState.mailboxId, mailboxId),
            eq(mailSyncProviderState.leaseId, leaseId)
          )
        );
      return { busy: false, hasMore: true };
    }
    const page =
      state.phase === "ready" ||
      state.phase === "sweep" ||
      history.nextPageToken
        ? null
        : await provider.threads(state.pageToken ?? undefined);
    const threadIds = [
      ...history.threadIds,
      ...(page?.threads.map((thread) => thread.id) ?? []),
    ];
    const threads = await fetchGmailSyncThreads(
      provider,
      store,
      mailboxId,
      threadIds
    );
    const labels =
      state.labelsSyncedAt === null ||
      Date.now() - state.labelsSyncedAt.getTime() > 5 * 60_000
        ? await provider.labels()
        : null;
    const unreadNonSpamCount =
      labels !== null || history.threadIds.length > 0
        ? await provider.unreadCount()
        : null;
    const importComplete =
      state.phase === "ready" ||
      state.phase === "sweep" ||
      (page !== null && !page.nextPageToken);
    let sweepComplete = state.phase !== "repair" && state.phase !== "sweep";
    await repository.transaction(mailboxId, async (context) => {
      await assertProviderLease(context, leaseId);
      await projectGmailThreads(context, threads, generation);
      if (labels !== null) {
        const details = await context.database
          .select()
          .from(gmailLabel)
          .where(eq(gmailLabel.mailboxId, mailboxId));
        const byId = new Map(details.map((detail) => [detail.labelId, detail]));
        const previous = await context.database
          .select({ id: mailSyncEntity.entityId })
          .from(mailSyncEntity)
          .where(
            and(
              eq(mailSyncEntity.mailboxId, mailboxId),
              eq(mailSyncEntity.kind, "label")
            )
          );
        const ids = new Set(labels.map((label) => label.id));
        for (const [position, label] of labels.entries()) {
          const detail = byId.get(label.id);
          context.put({
            data: {
              kind: "label",
              value: {
                ...label,
                color: detail?.color ?? "gray",
                description: detail?.description ?? null,
                inclusionCriteria: detail?.inclusionCriteria ?? null,
                position,
                visible: true,
              },
            },
            id: label.id,
            kind: "label",
          });
        }
        for (const label of previous) {
          if (!ids.has(label.id)) {
            context.put({ data: null, id: label.id, kind: "label" });
          }
        }
        await projectSavedViews(context);
      }
      if (
        importComplete &&
        (state.phase === "repair" || state.phase === "sweep")
      ) {
        const obsolete = await context.database
          .select()
          .from(mailSyncEntity)
          .where(
            and(
              eq(mailSyncEntity.mailboxId, mailboxId),
              inArray(mailSyncEntity.kind, ["message", "thread"]),
              isNotNull(mailSyncEntity.data),
              or(
                isNull(mailSyncEntity.providerGeneration),
                ne(mailSyncEntity.providerGeneration, generation)
              )
            )
          )
          .limit(500);
        sweepComplete = obsolete.length < 500;
        // Writes prepared in this transaction have not reached the projection table yet.
        const refreshed = new Set(threadIds);
        for (const entity of obsolete) {
          if (entity.threadId === null || !refreshed.has(entity.threadId)) {
            context.put({
              data: null,
              id: entity.entityId,
              kind: entity.kind,
              threadId: entity.threadId ?? undefined,
            });
          }
        }
      }
      let { phase } = state;
      if (importComplete) {
        phase = sweepComplete ? "ready" : "sweep";
      }
      if (unreadNonSpamCount !== null) {
        context.put({
          data: {
            kind: "overview",
            value: {
              counts: { unreadNonSpamCount },
              status: phase === "ready" ? "ready" : "importing",
            },
          },
          id: mailboxId,
          kind: "overview",
        });
      }
      await context.database
        .update(mailSyncProviderState)
        .set({
          bootstrapCursor: state.bootstrapCursor ?? cursor,
          cursor: history.nextPageToken ? cursor : history.historyId,
          historyPageToken: history.nextPageToken ?? null,
          inventoryGeneration: generation,
          labelsSyncedAt: labels === null ? state.labelsSyncedAt : new Date(),
          lastSyncedAt: new Date(),
          nextAttemptAt: new Date(
            Date.now() + (importComplete ? 60_000 : 1000)
          ),
          pageToken:
            page === null ? state.pageToken : (page.nextPageToken ?? null),
          phase,
          updatedAt: new Date(),
        })
        .where(eq(mailSyncProviderState.mailboxId, mailboxId));
      await context.database
        .update(mailSyncStream)
        .set({ initialized: true })
        .where(eq(mailSyncStream.mailboxId, mailboxId));
    });
    return {
      busy: false,
      hasMore:
        !importComplete || !sweepComplete || Boolean(history.nextPageToken),
    };
  });

export const hydrateGmailThreads = async (
  repository: SyncRepository,
  store: SyncBodyStore,
  mailboxId: string,
  provider: GmailSyncProvider,
  threadIds: string[]
) => {
  await withProviderLease(repository, mailboxId, async (state, leaseId) => {
    const threads = await fetchGmailSyncThreads(
      provider,
      store,
      mailboxId,
      threadIds
    );
    await repository.transaction(mailboxId, async (context) => {
      await assertProviderLease(context, leaseId);
      await projectGmailThreads(
        context,
        threads,
        state.inventoryGeneration ?? undefined
      );
    });
  });
};
