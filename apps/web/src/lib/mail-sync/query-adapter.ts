import type {
  MessageListItem,
  ThreadMessagesResult,
  MailboxCategory,
  ListMessagesPageResult,
} from "@quieter/mail/messages";
import type { SyncChange, SyncCommand } from "@quieter/sync";
import type { SyncClientEvent } from "@quieter/sync-client/types";
import type { QueryClient } from "@tanstack/react-query";

import { toastError } from "#/lib/error-toast";
import { applySyncDeltaToQueryData } from "#/lib/gmail/inbox-query/data";
import { getCachedMessagesQueries } from "#/lib/gmail/inbox-query/query-cache";
import { getThreadQueryKey } from "#/lib/gmail/thread-query-keys";

import { overlaySyncMessage, summarizeSyncThread } from "./command-adapter";
import { applyDeliveryChange } from "./delivery-adapter";
import {
  applySyncOverview,
  renderSyncLabels,
  renderSyncViews,
} from "./metadata-adapter";
import { clearPreparedMailHtml, warmPreparedMailHtml } from "./prepared-html";

export class MailSyncQueryAdapter {
  private readonly entities = new Map<string, Map<string, SyncChange>>();
  private readonly details = new Map<string, ThreadMessagesResult>();
  private readonly pending = new Map<string, SyncCommand>();
  private readonly owned = new Set<string>();
  private readonly providers = new Map<string, "gmail" | "managed">();
  private readonly fallbackSummaries = new Map<string, MessageListItem>();
  private readonly queryClient: QueryClient;
  private searchRefresh: ReturnType<typeof setTimeout> | null = null;
  private readGeneration = 0;

  constructor(queryClient: QueryClient) {
    this.queryClient = queryClient;
  }

  projectThread(mailboxId: string, thread: ThreadMessagesResult) {
    return {
      ...thread,
      messages: thread.messages.flatMap((message) => {
        const projected = this.overlay(mailboxId, message);
        return projected === null ? [] : [projected];
      }),
    };
  }

  setMailboxes(mailboxes: { id: string; provider: "gmail" | "managed" }[]) {
    for (const mailbox of mailboxes) {
      this.providers.set(mailbox.id, mailbox.provider);
    }
  }

  addCommand(command: SyncCommand) {
    this.owned.add(command.commandId);
    this.pending.set(command.commandId, command);
    for (const cached of getCachedMessagesQueries(
      this.queryClient,
      command.mailboxId
    )) {
      for (const message of cached.data?.pages.flatMap(
        (page) => page.messages
      ) ?? []) {
        const key = `${command.mailboxId}:${message.threadId}`;
        if (
          command.targets.some(
            (target) => target.threadId === message.threadId
          ) &&
          !this.fallbackSummaries.has(key)
        ) {
          this.fallbackSummaries.set(key, message);
        }
      }
    }
    for (const target of command.targets) {
      const key = `${command.mailboxId}:${target.threadId}`;
      const current = this.queryClient.getQueryData<ThreadMessagesResult>(
        getThreadQueryKey(command.mailboxId, target.threadId)
      );
      if (current !== undefined && !this.details.has(key)) {
        this.details.set(key, current);
      }
    }
    this.render(
      command.mailboxId,
      new Set(command.targets.map((target) => target.threadId))
    );
  }

  rejectCommand(command: SyncCommand) {
    this.pending.delete(command.commandId);
    this.owned.delete(command.commandId);
    this.render(
      command.mailboxId,
      new Set(command.targets.map((target) => target.threadId))
    );
    void this.queryClient.invalidateQueries({
      queryKey: ["messages", command.mailboxId],
    });
  }

  private overlay(
    mailboxId: string,
    message: MessageListItem,
    summary = false
  ) {
    return summary
      ? summarizeSyncThread({
          commands: [...this.pending.values()],
          entities: this.entities.get(mailboxId),
          fallback: message,
          mailboxId,
          threadId: message.threadId,
        })
      : overlaySyncMessage(
          mailboxId,
          message,
          this.pending.values(),
          this.entities.get(mailboxId)
        );
  }

  beginListRead(
    mailboxId: string,
    category: MailboxCategory,
    firstPage: boolean,
    search: boolean
  ) {
    const generation = this.readGeneration;
    const before = new Map(this.entities.get(mailboxId));
    return (page: ListMessagesPageResult): ListMessagesPageResult => {
      if (generation !== this.readGeneration) {
        throw new DOMException(
          "Mailbox cache changed during this request.",
          "AbortError"
        );
      }
      const entities = this.entities.get(mailboxId);
      const changed = new Set<string>();
      for (const entity of entities?.values() ?? []) {
        if (
          entity.kind === "thread" &&
          entity !== before.get(`thread:${entity.id}`)
        ) {
          changed.add(entity.id);
        }
      }
      const summaries = new Map<string, MessageListItem>();
      for (const message of page.messages) {
        if (entities?.get(`thread:${message.threadId}`)?.data === null) {
          continue;
        }
        const summary = changed.has(message.threadId)
          ? summarizeSyncThread({
              category,
              commands: [...this.pending.values()],
              entities,
              mailboxId,
              threadId: message.threadId,
            })
          : summarizeSyncThread({
              category,
              commands: [...this.pending.values()],
              entities: undefined,
              fallback: message,
              mailboxId,
              threadId: message.threadId,
            });
        if (summary !== null) {
          summaries.set(summary.threadId, summary);
        }
      }
      if (firstPage && !search) {
        for (const threadId of changed) {
          const summary = summarizeSyncThread({
            category,
            commands: [...this.pending.values()],
            entities,
            mailboxId,
            threadId,
          });
          if (summary !== null) {
            summaries.set(threadId, summary);
          }
        }
      }
      return {
        ...page,
        messages: [...summaries.values()].toSorted(
          (left, right) =>
            Number(right.internalDate ?? Date.parse(right.date ?? "")) -
            Number(left.internalDate ?? Date.parse(left.date ?? ""))
        ),
      };
    };
  }

  cachedList(
    mailboxId: string,
    category: MailboxCategory
  ): ListMessagesPageResult | undefined {
    const entities = this.entities.get(mailboxId);
    if (entities === undefined) {
      return undefined;
    }
    const messages: MessageListItem[] = [];
    for (const entity of entities.values()) {
      if (entity.data?.kind !== "thread") {
        continue;
      }
      const message = summarizeSyncThread({
        category,
        commands: [...this.pending.values()],
        entities,
        mailboxId,
        threadId: entity.id,
      });
      if (message !== null) {
        messages.push(message);
      }
    }
    messages.sort(
      (left, right) =>
        Number(right.internalDate ?? Date.parse(right.date ?? "")) -
        Number(left.internalDate ?? Date.parse(left.date ?? ""))
    );
    return messages.length === 0
      ? undefined
      : { messages: messages.slice(0, 15) };
  }

  receive(event: SyncClientEvent) {
    if (
      event.type === "receipt" &&
      (event.receipt.status === "failed" || event.receipt.status === "applied")
    ) {
      const command = this.pending.get(event.receipt.commandId);
      if (command !== undefined) {
        this.pending.delete(command.commandId);
        this.render(
          event.mailboxId,
          new Set(command.targets.map((target) => target.threadId))
        );
        if (
          this.owned.delete(command.commandId) &&
          event.receipt.status === "failed"
        ) {
          toastError(
            Object.assign(
              new Error(
                event.receipt.error ?? "This change could not be applied."
              ),
              { status: 400 }
            ),
            { boundary: "mail_sync_command" }
          );
        }
      }
      return;
    }
    if (event.type === "mailboxes-changed") {
      void this.queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
      return;
    }
    if (event.type === "session-ended") {
      this.dispose();
      this.queryClient.clear();
      return;
    }
    if (event.type === "cache-cleared") {
      clearPreparedMailHtml();
      this.readGeneration += 1;
      this.entities.clear();
      this.details.clear();
      this.fallbackSummaries.clear();
      this.queryClient.removeQueries({ queryKey: ["message-thread"] });
      void this.queryClient.invalidateQueries({ queryKey: ["messages"] });
      return;
    }
    if (event.type === "revoked") {
      clearPreparedMailHtml(event.mailboxId);
      this.readGeneration += 1;
      this.entities.delete(event.mailboxId);
      this.providers.delete(event.mailboxId);
      for (const key of this.details.keys()) {
        if (key.startsWith(`${event.mailboxId}:`)) {
          this.details.delete(key);
        }
      }
      for (const [id, command] of this.pending) {
        if (command.mailboxId === event.mailboxId) {
          this.pending.delete(id);
          this.owned.delete(id);
        }
      }
      this.queryClient.removeQueries({
        predicate: (query) => query.queryKey.includes(event.mailboxId),
      });
      void this.queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
      return;
    }
    if (event.type === "thread") {
      for (const message of event.thread.messages) {
        if (message.bodyHtml !== undefined) {
          warmPreparedMailHtml(event.mailboxId, message.bodyHtml);
        }
      }
      this.details.delete(`${event.mailboxId}:${event.thread.threadId}`);
      this.details.set(
        `${event.mailboxId}:${event.thread.threadId}`,
        event.thread
      );
      this.queryClient.setQueryData(
        getThreadQueryKey(event.mailboxId, event.thread.threadId),
        {
          ...event.thread,
          ...this.projectThread(event.mailboxId, event.thread),
        }
      );
      this.trimDetails();
      return;
    }
    if (event.type !== "entities") {
      return;
    }
    let previousEntities = this.entities.get(event.mailboxId);
    if (event.reset === true && previousEntities !== undefined) {
      clearPreparedMailHtml(event.mailboxId);
      this.readGeneration += 1;
      for (const key of this.details.keys()) {
        if (key.startsWith(`${event.mailboxId}:`)) {
          this.details.delete(key);
        }
      }
      this.queryClient.removeQueries({
        queryKey: ["message-thread", event.mailboxId],
      });
      void this.queryClient.invalidateQueries({
        queryKey: ["messages", event.mailboxId],
      });
      previousEntities = undefined;
    }
    const entities = event.replace
      ? new Map<string, SyncChange>()
      : (previousEntities ?? new Map<string, SyncChange>());
    this.entities.set(event.mailboxId, entities);
    const threads = new Set<string>();
    let labelsChanged = false;
    let viewsChanged = false;
    for (const entity of event.entities) {
      const key = `${entity.kind}:${entity.id}`;
      const previousEntity = previousEntities?.get(key);
      if (
        previousEntity !== undefined &&
        BigInt(previousEntity.version) >= BigInt(entity.version)
      ) {
        entities.set(key, previousEntity);
        continue;
      }
      entities.delete(key);
      entities.set(key, entity);
      applyDeliveryChange(this.queryClient, event.mailboxId, entity);
      if (entity.kind === "thread") {
        threads.add(entity.id);
        this.fallbackSummaries.delete(`${event.mailboxId}:${entity.id}`);
      }
      if (entity.kind === "message") {
        const message =
          entity.data?.kind === "message" ? entity.data.value : null;
        const previousMessage =
          previousEntity?.data?.kind === "message"
            ? previousEntity.data.value
            : null;
        const threadId = message?.threadId ?? previousMessage?.threadId;
        if (threadId !== undefined) {
          threads.add(threadId);
        }
        if (
          threadId !== undefined &&
          message?.body?.hash !== previousMessage?.body?.hash
        ) {
          const detailKey = `${event.mailboxId}:${threadId}`;
          const detail = this.details.get(detailKey);
          if (detail !== undefined) {
            this.details.set(detailKey, {
              ...detail,
              messages: detail.messages.map((item) =>
                item.id === entity.id
                  ? { ...item, bodyHtml: undefined, bodyText: undefined }
                  : item
              ),
            });
          }
        }
      }
      if (entity.kind === "label") {
        labelsChanged = true;
      }
      if (entity.kind === "saved-view") {
        viewsChanged = true;
      }
      if (entity.data?.kind === "overview") {
        applySyncOverview(
          this.queryClient,
          event.mailboxId,
          this.providers.get(event.mailboxId),
          entity.data.value
        );
      }
      if (entity.data?.kind === "command") {
        const { command, error, status } = entity.data.value;
        for (const target of command.targets) {
          threads.add(target.threadId);
        }
        if (status === "accepted" || status === "running") {
          this.pending.set(command.commandId, command);
        } else {
          this.pending.delete(command.commandId);
          if (this.owned.delete(command.commandId) && status === "failed") {
            toastError(
              Object.assign(
                new Error(error ?? "This change could not be applied."),
                { status: 400 }
              ),
              { boundary: "mail_sync_command" }
            );
          }
        }
      }
    }
    this.render(event.mailboxId, threads);
    if (labelsChanged) {
      this.render(
        event.mailboxId,
        new Set(
          [...entities.values()]
            .filter((entity) => entity.kind === "thread")
            .map((entity) => entity.id)
        )
      );
      renderSyncLabels(
        this.queryClient,
        event.mailboxId,
        this.providers.get(event.mailboxId),
        entities
      );
    }
    if (viewsChanged || event.replace) {
      renderSyncViews(this.queryClient, event.mailboxId, entities);
    }
    while (entities.size > 10_000) {
      const oldest = entities.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      entities.delete(oldest);
    }
    if (!event.replace && threads.size > 0 && this.searchRefresh === null) {
      this.searchRefresh = setTimeout(() => {
        this.searchRefresh = null;
        void this.queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "messages" &&
            typeof query.queryKey[3] === "string" &&
            query.queryKey[3].length > 0,
        });
      }, 500);
    }
  }

  private render(mailboxId: string, threadIds: Set<string>) {
    const entities = this.entities.get(mailboxId);
    for (const threadId of threadIds) {
      const entity = entities?.get(`thread:${threadId}`);
      const thread = entity?.data?.kind === "thread" ? entity.data.value : null;
      const detailKey = `${mailboxId}:${threadId}`;
      const detail = this.details.get(detailKey);
      if (entity?.data === null) {
        this.details.delete(detailKey);
        this.queryClient.setQueryData(getThreadQueryKey(mailboxId, threadId), {
          messages: [],
          threadId,
        });
      } else if (detail !== undefined) {
        const messages = detail.messages.flatMap((message) => {
          const updated = entities?.get(`message:${message.id}`);
          if (
            updated?.data === null ||
            (thread !== null && !thread.messageIds.includes(message.id))
          ) {
            return [];
          }
          const metadata =
            updated?.data?.kind === "message" ? updated.data.value : message;
          return [
            {
              ...metadata,
              bodyHtml: message.bodyHtml,
              bodyText: message.bodyText,
            },
          ];
        });
        const next = { ...detail, messages };
        this.details.set(detailKey, next);
        this.queryClient.setQueryData(getThreadQueryKey(mailboxId, threadId), {
          ...next,
          ...this.projectThread(mailboxId, next),
        });
      }
    }
    for (const cached of getCachedMessagesQueries(
      this.queryClient,
      mailboxId
    )) {
      if (cached.data === undefined) {
        continue;
      }
      const previous = cached.data.pages.flatMap((page) => page.messages);
      const changed: MessageListItem[] = [];
      for (const threadId of threadIds) {
        const fallback =
          this.fallbackSummaries.get(`${mailboxId}:${threadId}`) ??
          previous.find((message) => message.threadId === threadId);
        const summary = summarizeSyncThread({
          category: cached.mailbox,
          commands: [...this.pending.values()],
          entities,
          fallback,
          mailboxId,
          threadId,
        });
        if (
          summary !== null &&
          (!cached.searchQuery ||
            previous.some((message) => message.threadId === threadId))
        ) {
          changed.push(summary);
        }
      }
      this.queryClient.setQueryData(
        cached.queryKey,
        applySyncDeltaToQueryData(
          cached.data,
          changed,
          previous
            .filter((message) => threadIds.has(message.threadId))
            .map((message) => message.id)
        )
      );
    }
  }

  private trimDetails() {
    let bytes = 0;
    for (const thread of this.details.values()) {
      for (const message of thread.messages) {
        bytes +=
          ((message.bodyHtml?.length ?? 0) + (message.bodyText?.length ?? 0)) *
          2;
      }
    }
    for (const [key, thread] of this.details) {
      if (bytes < 32 * 1024 * 1024) {
        break;
      }
      const mailboxId = key.slice(0, -(thread.threadId.length + 1));
      const queryKey = getThreadQueryKey(mailboxId, thread.threadId);
      if (
        (this.queryClient
          .getQueryCache()
          .find({ exact: true, queryKey })
          ?.getObserversCount() ?? 0) > 0
      ) {
        continue;
      }
      this.details.delete(key);
      this.queryClient.removeQueries({ exact: true, queryKey });
      for (const message of thread.messages) {
        bytes -=
          ((message.bodyHtml?.length ?? 0) + (message.bodyText?.length ?? 0)) *
          2;
      }
    }
  }

  dispose() {
    clearPreparedMailHtml();
    this.readGeneration += 1;
    if (this.searchRefresh !== null) {
      clearTimeout(this.searchRefresh);
    }
    this.entities.clear();
    this.details.clear();
    this.pending.clear();
    this.owned.clear();
    this.fallbackSummaries.clear();
  }
}
