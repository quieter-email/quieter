"use client";

import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import {
  isMailSearchFilterSupported,
  parseStructuredSearchQuery,
} from "@quieter/mail/search";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { toast } from "@quieter/ui/toast";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import { MessageList } from "#/features/message-list/components/message-list";
import type { MessageListMailboxContext } from "#/features/message-list/components/message-list-types";
import { toastError } from "#/lib/error-toast";
import { buildThreadListEntries } from "#/lib/gmail/thread-list";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";
import type { MailboxCategory, MessageListItem } from "#/lib/mail";
import {
  liveSyncQueryOptions,
  messagesQueryOptions,
} from "#/lib/mail/inbox-query";
import { isMailboxScopeRepairRequiredError } from "#/lib/orpc-errors";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

import {
  buildUnifiedInboxEntries,
  defaultMailboxColor,
  useUnifiedInboxPreferences,
  writeUnifiedInboxPreferences,
} from "../domain/unified-inbox";
import type {
  UnifiedInboxMailbox,
  UnifiedInboxPreferences,
} from "../domain/unified-inbox";
import {
  markMailboxNeedsReconnectInCache,
  useWindowActive,
} from "./mailbox-workspace/use-mailbox-messages";
import {
  createUnifiedInboxActions,
  useUnifiedInboxSourceActions,
} from "./unified-inbox-actions";

type SourceState = {
  messages: MessageListItem[];
  hasNextPage: boolean;
  isPending: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  fetchNextPage: () => Promise<{ error: unknown }>;
  refetch: () => Promise<{ error: unknown }>;
  mailboxActions: MailboxActions;
  pendingActions: MailboxPendingActions;
};

type ConnectedMailbox = UnifiedInboxMailbox & { provider: "gmail" | "managed" };

type UnifiedInboxPanelProps = {
  activeMailbox: MailboxCategory;
  mailboxes: UnifiedInboxMailbox[];
  userId: string;
  searchQuery: string;
  onSearch: (query: string) => void;
  onOpenSidebar: () => void;
  onSelectMessage: (
    mailboxId: string,
    messageId: string,
    threadId: string
  ) => void;
  onDeactivateActiveMessage: () => void;
  onOpenDraft: (mailboxId: string, message: MessageListItem) => void;
  onKeyboardOpenMessage?: () => void;
  activeMailboxId: string | null;
  activeMessageId: string | null;
  onReconnectMailbox?: (mailbox: UnifiedInboxMailbox) => void;
};

const UnifiedInboxSource = ({
  activeMailbox,
  isWindowActive,
  mailbox,
  onChange,
  searchQuery,
  sourceKey,
}: {
  activeMailbox: MailboxCategory;
  isWindowActive: boolean;
  mailbox: ConnectedMailbox;
  onChange: (sourceKey: string, state: SourceState | null) => void;
  searchQuery: string;
  sourceKey: string;
}) => {
  const queryClient = useQueryClient();
  const { mailboxActions, pendingActions } = useUnifiedInboxSourceActions({
    activeMailbox,
    mailboxId: mailbox.id,
    mailboxProvider: mailbox.provider,
    searchQuery,
  });
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch,
  } = useInfiniteQuery(
    messagesQueryOptions(mailbox.id, activeMailbox, searchQuery)
  );
  const { error: syncError, refetch: refetchUpdates } = useQuery(
    liveSyncQueryOptions(
      queryClient,
      mailbox.id,
      activeMailbox,
      searchQuery,
      activeMailbox !== "drafts" &&
        searchQuery.length === 0 &&
        data !== undefined &&
        isWindowActive &&
        !isSandboxMailboxId(mailbox.id)
    )
  );
  useEffect(() => {
    const repairError = [error, syncError].find(
      isMailboxScopeRepairRequiredError
    );
    if (repairError !== undefined) {
      markMailboxNeedsReconnectInCache(queryClient, repairError);
    }
  }, [error, queryClient, syncError]);
  const refreshSource = useCallback(async () => {
    const messagesResult = await refetch();
    if (messagesResult.error !== null && messagesResult.error !== undefined) {
      return { error: messagesResult.error };
    }
    if (
      activeMailbox === "drafts" ||
      searchQuery.length > 0 ||
      isSandboxMailboxId(mailbox.id)
    ) {
      return { error: null };
    }
    const updatesResult = await refetchUpdates();
    return { error: updatesResult.error };
  }, [activeMailbox, mailbox.id, refetch, refetchUpdates, searchQuery]);
  const messages = useMemo(
    () => data?.pages.flatMap((page) => page.messages) ?? [],
    [data]
  );
  useEffect(() => {
    onChange(sourceKey, {
      error: error ?? syncError,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      isPending,
      mailboxActions,
      messages,
      pendingActions,
      refetch: refreshSource,
    });
  }, [
    sourceKey,
    onChange,
    error,
    syncError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    mailboxActions,
    messages,
    pendingActions,
    refreshSource,
  ]);
  useEffect(
    () => () => {
      onChange(sourceKey, null);
    },
    [sourceKey, onChange]
  );
  return null;
};

export const UnifiedInboxPanel = ({
  activeMailbox,
  activeMailboxId,
  activeMessageId,
  mailboxes,
  onDeactivateActiveMessage,
  onKeyboardOpenMessage,
  onOpenDraft,
  onOpenSidebar,
  onReconnectMailbox,
  onSearch,
  onSelectMessage,
  searchQuery,
  userId,
}: UnifiedInboxPanelProps) => {
  const isWindowActive = useWindowActive();
  const preferences = useUnifiedInboxPreferences(userId);
  const accessibleMailboxes = mailboxes.filter(
    (mailbox): mailbox is ConnectedMailbox => mailbox.provider !== "api"
  );
  const accessibleIds = accessibleMailboxes.map((mailbox) => mailbox.id);
  const selectedMailboxes = accessibleMailboxes.filter(
    (mailbox) => !preferences.excludedIds.includes(mailbox.id)
  );
  const connectedMailboxes = selectedMailboxes.filter(
    (mailbox) => mailbox.connectionStatus === "connected"
  );
  const reconnectMailboxes = selectedMailboxes.filter(
    (mailbox) => mailbox.connectionStatus === "needs_reconnect"
  );
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>(
    {}
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const normalizedSearch = searchQuery.trim();
  const hasUnsupportedSearch = parseStructuredSearchQuery(
    normalizedSearch
  ).filters.some((filter) =>
    connectedMailboxes.some(
      (mailbox) => !isMailSearchFilterSupported(mailbox.provider, filter)
    )
  );
  const queryMailboxes = hasUnsupportedSearch ? [] : connectedMailboxes;
  const onSourceChange = useCallback(
    (key: string, state: SourceState | null) => {
      setSourceStates((current) => {
        if (state === null) {
          if (!(key in current)) {
            return current;
          }
          return Object.fromEntries(
            Object.entries(current).filter(([id]) => id !== key)
          );
        }
        const previous = current[key];
        if (
          previous !== undefined &&
          previous.messages === state.messages &&
          previous.error === state.error &&
          previous.hasNextPage === state.hasNextPage &&
          previous.isPending === state.isPending &&
          previous.isFetchingNextPage === state.isFetchingNextPage &&
          previous.fetchNextPage === state.fetchNextPage &&
          previous.refetch === state.refetch &&
          previous.mailboxActions === state.mailboxActions &&
          previous.pendingActions === state.pendingActions
        ) {
          return current;
        }
        return { ...current, [key]: state };
      });
    },
    []
  );
  const connectedStates = queryMailboxes.map((mailbox) => ({
    mailbox,
    state:
      sourceStates[
        JSON.stringify([mailbox.id, activeMailbox, normalizedSearch])
      ],
  }));
  const pending = connectedStates.some(
    ({ state }) => state === undefined || state.isPending
  );
  const successfulSources = connectedStates.filter(
    ({ state }) =>
      state !== undefined &&
      !state.isPending &&
      (state.messages.length > 0 || state.error === null)
  );
  const entries = buildUnifiedInboxEntries(
    successfulSources.map(({ mailbox, state }) => ({
      hasNextPage: state?.error === null && (state?.hasNextPage ?? false),
      mailboxId: mailbox.id,
      messages: state?.messages ?? [],
    }))
  );
  const visibleEntries = pending ? [] : entries;
  const failedSources = connectedStates.filter(
    ({ state }) => state !== undefined && state.error !== null
  );
  const hasNextPage = connectedStates.some(
    ({ state }) => state?.hasNextPage && state.error === null
  );
  const isFetchingMore = connectedStates.some(
    ({ state }) => state?.isFetchingNextPage
  );

  const updatePreferences = (next: UnifiedInboxPreferences) => {
    writeUnifiedInboxPreferences(userId, next, accessibleIds);
  };
  const toggleMailbox = (mailboxId: string) => {
    const excludedIds = preferences.excludedIds.includes(mailboxId)
      ? preferences.excludedIds.filter((id) => id !== mailboxId)
      : [...preferences.excludedIds, mailboxId];
    updatePreferences({ ...preferences, excludedIds });
  };
  const setColor = (mailboxId: string, color: MailboxLabelColor) => {
    updatePreferences({
      ...preferences,
      colors: { ...preferences.colors, [mailboxId]: color },
    });
  };
  const refresh = async () => {
    if (isRefreshing || connectedStates.length === 0 || pending) {
      return;
    }
    setIsRefreshing(true);
    try {
      const results = await Promise.allSettled(
        connectedStates.map(async ({ state }) => {
          const result = await state?.refetch();
          if (
            result !== undefined &&
            result.error !== null &&
            result.error !== undefined
          ) {
            throw new Error("Could not refresh inbox.", {
              cause: result.error,
            });
          }
        })
      );
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );
      for (const failure of failures) {
        toastError(failure.reason, { boundary: "unified-inbox-refresh" });
      }
      if (failures.length === 0) {
        toast.success("Inboxes refreshed.");
      }
    } finally {
      setIsRefreshing(false);
    }
  };
  const loadMore = async () => {
    const sources = connectedStates.filter(
      ({ state }) =>
        state?.hasNextPage && !state.isFetchingNextPage && state.error === null
    );
    const results = await Promise.allSettled(
      sources.map(async ({ state }) => {
        const page = await state?.fetchNextPage();
        if (
          page !== undefined &&
          page.error !== null &&
          page.error !== undefined
        ) {
          throw new Error("Could not load more messages.", {
            cause: page.error,
          });
        }
      })
    );
    for (const result of results) {
      if (result.status === "rejected") {
        toastError(result.reason, { boundary: "unified-inbox-page" });
      }
    }
  };
  const retryMailbox = async (mailboxId: string) => {
    try {
      const result =
        await sourceStates[
          JSON.stringify([mailboxId, activeMailbox, normalizedSearch])
        ]?.refetch();
      if (
        result !== undefined &&
        result.error !== null &&
        result.error !== undefined
      ) {
        throw new Error("Could not retry inbox.", { cause: result.error });
      }
    } catch (error) {
      toastError(error, { boundary: "unified-inbox-retry" });
    }
  };

  const realContexts = new Map<string, MessageListMailboxContext>();
  const originalThreadById = new Map<string, ThreadListEntry>();
  const originalMessageById = new Map<string, MessageListItem>();
  const sourceMailboxByMessageId = new Map<string, string>();
  const syntheticMessages: MessageListItem[] = [];
  for (const { mailbox, state } of successfulSources) {
    if (state === undefined) {
      continue;
    }
    const originalThreads =
      activeMailbox === "drafts"
        ? state.messages.map((message): ThreadListEntry => ({
            anchorMessage: message,
            attachmentCount:
              message.threadAttachmentCount ?? message.attachments?.length ?? 0,
            messageCount: Math.max(1, message.threadMessageCount ?? 0),
            messages: [message],
            participants: [],
            preview: message.snippet?.trim() ?? "",
            subject: message.subject?.trim() ?? "(No subject)",
            threadId: message.draftId ?? message.id,
            threadLabelIds: message.threadLabelIds ?? message.labelIds ?? [],
            unreadCount: 0,
          }))
        : buildThreadListEntries(state.messages);
    for (const thread of originalThreads) {
      const uiThreadId = JSON.stringify([mailbox.id, thread.threadId]);
      const originalMessageIds = new Map<string, string>();
      for (const message of thread.messages) {
        originalMessageIds.set(
          JSON.stringify([mailbox.id, message.id]),
          message.id
        );
      }
      const color =
        preferences.colors[mailbox.id] ?? defaultMailboxColor(mailbox.id);
      realContexts.set(uiThreadId, {
        badge: (
          <Pill
            aria-hidden
            shape="circle"
            size="icon"
            tone={color}
            variant="outline"
          >
            {/[\p{L}\p{N}]/u
              .exec(mailbox.displayName?.trim() || mailbox.emailAddress)?.[0]
              ?.toUpperCase() ?? "?"}
          </Pill>
        ),
        emailAddress: mailbox.emailAddress,
        mailboxActions: state.mailboxActions,
        mailboxId: mailbox.id,
        mailboxProvider: mailbox.provider,
        originalMessageIds,
        originalThreadId: thread.threadId,
        pendingActions: state.pendingActions,
      });
      originalThreadById.set(uiThreadId, thread);
    }
  }
  for (const { mailboxId, message } of visibleEntries) {
    const uiMessageId = JSON.stringify([mailboxId, message.id]);
    const uiThreadId = JSON.stringify([
      mailboxId,
      activeMailbox === "drafts"
        ? (message.draftId ?? message.id)
        : message.threadId,
    ]);
    if (!realContexts.has(uiThreadId)) {
      continue;
    }
    originalMessageById.set(uiMessageId, message);
    sourceMailboxByMessageId.set(uiMessageId, mailboxId);
    syntheticMessages.push({
      ...message,
      draftId:
        message.draftId === undefined
          ? undefined
          : JSON.stringify([mailboxId, message.draftId]),
      id: uiMessageId,
      threadId: uiThreadId,
    });
  }
  const adapter = createUnifiedInboxActions({
    contextsByThreadId: realContexts,
    originalMessageById,
    originalThreadById,
  });
  const mailboxContextsByThreadId = new Map<
    string,
    MessageListMailboxContext
  >();
  for (const [id, context] of realContexts) {
    mailboxContextsByThreadId.set(id, {
      ...context,
      mailboxActions: adapter.mailboxActions,
      pendingActions: adapter.pendingActions,
    });
  }
  const selectionScopeKey = JSON.stringify([
    userId,
    activeMailbox,
    normalizedSearch,
    selectedMailboxes.map((mailbox) => mailbox.id),
  ]);
  const searchMailbox =
    connectedMailboxes.find((mailbox) => mailbox.id === activeMailboxId) ??
    connectedMailboxes[0] ??
    mailboxes.find((mailbox) => mailbox.id === activeMailboxId) ??
    mailboxes[0];
  const listError =
    failedSources.length === connectedStates.length &&
    connectedStates.length > 0 &&
    syntheticMessages.length === 0
      ? failedSources[0]?.state?.error
      : null;
  const listNotices = (
    <>
      {hasUnsupportedSearch && (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-body-sm"
          role="alert"
        >
          <span>
            Some search filters are unavailable for the selected inboxes. Remove
            those filters or change your selected inboxes.
          </span>
          <Button
            onClick={() => {
              onSearch("");
            }}
            size="sm"
            variant="outline"
          >
            Clear search
          </Button>
        </div>
      )}
      {selectedMailboxes.length === 0 && (
        <p className="rounded-md bg-muted/40 px-3 py-3 text-body-sm text-muted-fg">
          Choose an inbox to show its messages.
        </p>
      )}
      {reconnectMailboxes.map((mailbox) => (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-body-sm"
          key={mailbox.id}
        >
          <span>
            {mailbox.displayName?.trim() || mailbox.emailAddress} needs to be
            reconnected.
          </span>
          {onReconnectMailbox !== undefined && (
            <Button
              onClick={() => {
                onReconnectMailbox(mailbox);
              }}
              size="sm"
              variant="outline"
            >
              Reconnect
            </Button>
          )}
        </div>
      ))}
      {failedSources.map(({ mailbox }) => (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-body-sm"
          key={mailbox.id}
        >
          <span>
            {mailbox.displayName?.trim() || mailbox.emailAddress} could not
            load.
          </span>
          <Button
            onClick={() => {
              void retryMailbox(mailbox.id);
            }}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ))}
    </>
  );
  const headerAddon = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 items-center gap-1">
          {selectedMailboxes.slice(0, 3).map((mailbox) => (
            <IconButtonTooltip
              key={mailbox.id}
              label={`${mailbox.displayName?.trim() || mailbox.emailAddress}, ${mailbox.emailAddress}`}
            >
              <Pill
                aria-hidden
                shape="circle"
                size="icon"
                tone={
                  preferences.colors[mailbox.id] ??
                  defaultMailboxColor(mailbox.id)
                }
                variant="outline"
              >
                {/[\p{L}\p{N}]/u
                  .exec(
                    mailbox.displayName?.trim() || mailbox.emailAddress
                  )?.[0]
                  ?.toUpperCase() ?? "?"}
              </Pill>
            </IconButtonTooltip>
          ))}
          {selectedMailboxes.length > 3 && (
            <span className="text-micro text-muted-fg">
              +{selectedMailboxes.length - 3}
            </span>
          )}
        </div>
        <span className="truncate text-caption text-muted-fg">
          {selectedMailboxes.length === 0
            ? "All inboxes"
            : selectedMailboxes
                .map(
                  (mailbox) =>
                    mailbox.displayName?.trim() || mailbox.emailAddress
                )
                .join(", ")}
        </span>
      </div>
      <Popover>
        <PopoverTrigger
          aria-label="Choose inboxes"
          // oxlint-disable-next-line shadcn/no-restyle -- Match the compact list toolbar.
          className="rounded-md px-2 py-1 text-caption text-muted-fg hover:bg-muted/60 hover:text-fg"
        >
          Inboxes ({selectedMailboxes.length})
        </PopoverTrigger>
        <PopoverContent
          align="end"
          // oxlint-disable-next-line shadcn/no-restyle -- Keep mailbox choices readable at compact width.
          className="w-72 p-2"
        >
          <p className="px-2 py-1 text-caption font-medium text-muted-fg">
            Show inboxes
          </p>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {accessibleMailboxes.map((mailbox) => (
              <div
                className="rounded-md px-2 py-2 hover:bg-muted/40"
                key={mailbox.id}
              >
                <label
                  className="flex cursor-pointer items-start gap-2"
                  htmlFor={`unified-inbox-${mailbox.id}`}
                >
                  <Checkbox
                    id={`unified-inbox-${mailbox.id}`}
                    aria-label={`Show ${mailbox.displayName?.trim() || mailbox.emailAddress}`}
                    checked={!preferences.excludedIds.includes(mailbox.id)}
                    className="mt-1"
                    onCheckedChange={() => {
                      toggleMailbox(mailbox.id);
                    }}
                  >
                    <CheckboxIndicator />
                  </Checkbox>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-fg">
                      {mailbox.displayName?.trim() || mailbox.emailAddress}
                    </span>
                    <span
                      className="block truncate text-caption text-muted-fg"
                      title={mailbox.emailAddress}
                    >
                      {mailbox.emailAddress}
                    </span>
                  </span>
                </label>
                <MailboxColorPicker
                  className="mt-2 ml-5"
                  label={`Color for ${mailbox.displayName?.trim() || mailbox.emailAddress}`}
                  onChange={(color) => {
                    setColor(mailbox.id, color);
                  }}
                  value={
                    preferences.colors[mailbox.id] ??
                    defaultMailboxColor(mailbox.id)
                  }
                />
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {queryMailboxes.map((mailbox) => {
        const sourceKey = JSON.stringify([
          mailbox.id,
          activeMailbox,
          normalizedSearch,
        ]);
        return (
          <UnifiedInboxSource
            activeMailbox={activeMailbox}
            isWindowActive={isWindowActive}
            key={sourceKey}
            mailbox={mailbox}
            onChange={onSourceChange}
            searchQuery={normalizedSearch}
            sourceKey={sourceKey}
          />
        );
      })}
      <MessageList
        activeMailbox={activeMailbox}
        activeMessageId={
          activeMailboxId !== null && activeMessageId !== null
            ? JSON.stringify([activeMailboxId, activeMessageId])
            : null
        }
        error={listError}
        hasNextPage={hasNextPage}
        headerAddon={headerAddon}
        isError={listError !== null && listError !== undefined}
        isFetchingNextPage={isFetchingMore}
        isPending={pending}
        isRefreshing={isRefreshing}
        listNotices={listNotices}
        mailboxActions={adapter.mailboxActions}
        mailboxContextsByThreadId={mailboxContextsByThreadId}
        mailboxId={searchMailbox?.id ?? ""}
        mailboxProvider={searchMailbox?.provider ?? "managed"}
        messages={[{ messages: syntheticMessages }]}
        onActivateMessage={(uiMessageId) => {
          const original = originalMessageById.get(uiMessageId);
          const sourceId = sourceMailboxByMessageId.get(uiMessageId);
          if (original !== undefined && sourceId !== undefined) {
            if (activeMailbox === "drafts") {
              onOpenDraft(sourceId, original);
              return;
            }
            onSelectMessage(sourceId, original.id, original.threadId);
          }
        }}
        onDeactivateActiveMessage={onDeactivateActiveMessage}
        onKeyboardOpenMessage={onKeyboardOpenMessage}
        onLoadMore={() => {
          void loadMore();
        }}
        onOpenDraft={(uiMessage) => {
          const original = originalMessageById.get(uiMessage.id);
          const sourceId = sourceMailboxByMessageId.get(uiMessage.id);
          if (original !== undefined && sourceId !== undefined) {
            onOpenDraft(sourceId, original);
          }
        }}
        onOpenSidebar={onOpenSidebar}
        onRefresh={() => {
          void refresh();
        }}
        onSearch={onSearch}
        pendingActions={adapter.pendingActions}
        searchQuery={normalizedSearch}
        searchMailboxes={connectedMailboxes.map((mailbox) => ({
          mailboxId: mailbox.id,
          mailboxProvider: mailbox.provider,
        }))}
        selectionScopeKey={selectionScopeKey}
      />
    </div>
  );
};
