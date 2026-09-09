import {
  mailSyncEntity,
  mailSyncProviderState,
  mailSyncStream,
} from "@quieter/database/schema";
import {
  getGmailProfile,
  getThreadWithDetails,
  isGmailServiceError,
  listGmailSyncHistoryPage,
  listGmailSyncThreads,
  listLabels,
} from "@quieter/gmail";
import type { MailLabelListItem } from "@quieter/mail/messages";
import type { SyncMessage } from "@quieter/sync";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";

import { prepareSyncMessage } from "../body-store";
import type { SyncBodyStore } from "../body-store";
import type { SyncRepository, SyncTransaction } from "../repository";

export type GmailSyncProvider = {
  profile: () => ReturnType<typeof getGmailProfile>;
  history: (
    cursor: string,
    pageToken?: string
  ) => ReturnType<typeof listGmailSyncHistoryPage>;
  threads: (pageToken?: string) => ReturnType<typeof listGmailSyncThreads>;
  thread: (threadId: string) => ReturnType<typeof getThreadWithDetails>;
  labels: () => Promise<MailLabelListItem[]>;
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
) => {
  await repository.database
    .insert(mailSyncProviderState)
    .values({ mailboxId })
    .onConflictDoNothing();
  const leaseId = crypto.randomUUID();
  const [state] = await repository.database
    .update(mailSyncProviderState)
    .set({
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseId,
    })
    .where(
      and(
        eq(mailSyncProviderState.mailboxId, mailboxId),
        or(
          isNull(mailSyncProviderState.leaseExpiresAt),
          lt(mailSyncProviderState.leaseExpiresAt, new Date())
        )
      )
    )
    .returning();
  if (state === undefined) {
    return { busy: true, hasMore: true };
  }
  const generation = state.inventoryGeneration ?? crypto.randomUUID();
  try {
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
      state.phase === "ready" || history.nextPageToken
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
    const importComplete =
      state.phase === "ready" || (page !== null && !page.nextPageToken);
    await repository.transaction(mailboxId, async (context) => {
      const [fence] = await context.database
        .select()
        .from(mailSyncProviderState)
        .where(eq(mailSyncProviderState.mailboxId, mailboxId))
        .for("update");
      if (
        fence?.leaseId !== leaseId ||
        fence.leaseExpiresAt === null ||
        fence.leaseExpiresAt.getTime() <= Date.now()
      ) {
        throw new Error("Mailbox processing ownership expired.");
      }
      await projectGmailThreads(context, threads, generation);
      if (labels !== null) {
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
        for (const label of labels) {
          context.put({
            data: { kind: "label", value: label },
            id: label.id,
            kind: "label",
          });
        }
        for (const label of previous) {
          if (!ids.has(label.id)) {
            context.put({ data: null, id: label.id, kind: "label" });
          }
        }
      }
      if (importComplete && state.phase === "repair") {
        const obsolete = await context.database
          .select()
          .from(mailSyncEntity)
          .where(
            and(
              eq(mailSyncEntity.mailboxId, mailboxId),
              inArray(mailSyncEntity.kind, ["message", "thread"]),
              or(
                isNull(mailSyncEntity.providerGeneration),
                ne(mailSyncEntity.providerGeneration, generation)
              )
            )
          );
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
          phase: importComplete ? "ready" : state.phase,
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
      hasMore: !importComplete || Boolean(history.nextPageToken),
    };
  } finally {
    await repository.database
      .update(mailSyncProviderState)
      .set({ leaseExpiresAt: null, leaseId: null })
      .where(
        and(
          eq(mailSyncProviderState.mailboxId, mailboxId),
          eq(mailSyncProviderState.leaseId, leaseId)
        )
      );
  }
};
