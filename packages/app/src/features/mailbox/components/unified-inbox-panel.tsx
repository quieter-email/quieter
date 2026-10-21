"use client";

import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { useMailboxListController } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller";
import { createUnifiedInboxActions } from "@quieter/app/features/mailbox/components/unified-inbox-actions";
import { useBriefMailboxActivity } from "@quieter/app/features/mailbox/components/use-brief-mailbox-activity";
import {
  buildUnifiedInboxEntries,
  defaultMailboxColor,
  useUnifiedInboxPreferences,
  writeUnifiedInboxPreferences,
} from "@quieter/app/features/mailbox/domain/unified-inbox";
import type {
  UnifiedInboxMailbox,
  UnifiedInboxPreferences,
} from "@quieter/app/features/mailbox/domain/unified-inbox";
import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import { MessageList } from "@quieter/app/features/message-list/components/message-list";
import type { MessageListMailboxContext } from "@quieter/app/features/message-list/components/message-list-types";
import { toastError } from "@quieter/app/lib/error-toast";
import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import {
  isGmailSandboxMailboxId,
  isManagedSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import {
  isMailSearchFilterSupported,
  parseStructuredSearchQuery,
} from "@quieter/mail/search";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { ColorSwatch } from "@quieter/ui/color-swatch";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { toast } from "@quieter/ui/toast";
import { useCallback, useEffect, useState } from "react";

type SourceState = {
  messages: MessageListItem[];
  paginationMessages: MessageListItem[];
  retainedMessageId: string | null;
  activateMessage: (messageId: string) => void;
  resetSelection: () => void;
  hasNextPage: boolean;
  isPending: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  syncError: unknown;
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
  activeThreadId: string | null;
  onReconnectMailbox?: (mailbox: UnifiedInboxMailbox) => void;
};

const UnifiedInboxSource = ({
  activeMailbox,
  activeMessageId,
  activeThreadId,
  mailbox,
  onChange,
  searchQuery,
  sourceKey,
  selectionScopeKey,
}: {
  activeMailbox: MailboxCategory;
  activeMessageId: string | null;
  activeThreadId: string | null;
  mailbox: ConnectedMailbox;
  onChange: (sourceKey: string, state: SourceState | null) => void;
  searchQuery: string;
  sourceKey: string;
  selectionScopeKey: string;
}) => {
  const {
    activateListMessage,
    fetchNextPage,
    flattenedMessages,
    listState,
    mailboxActions,
    paginationMessages,
    pendingActions,
    refreshMessages,
    resetListSelection,
    retainedMessageId,
    syncError,
  } = useMailboxListController({
    activeMailbox,
    isDemoMode: isGmailSandboxMailboxId(mailbox.id),
    isManagedDemoMode: isManagedSandboxMailboxId(mailbox.id),
    mailboxId: mailbox.id,
    mailboxProvider: mailbox.provider,
    messageId: activeMessageId,
    searchQuery,
    selectionScopeKey,
    threadId: activeThreadId,
  });
  const { error, hasNextPage, isFetchingNextPage, isPending } = listState;
  const refreshSource = useCallback(async () => {
    await refreshMessages();
    return { error: null };
  }, [refreshMessages]);
  useEffect(() => {
    onChange(sourceKey, {
      activateMessage: activateListMessage,
      error,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      isPending,
      mailboxActions,
      messages: flattenedMessages,
      paginationMessages,
      pendingActions,
      refetch: refreshSource,
      resetSelection: resetListSelection,
      retainedMessageId,
      syncError: syncError ?? null,
    });
  }, [
    activateListMessage,
    sourceKey,
    onChange,
    error,
    syncError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    mailboxActions,
    flattenedMessages,
    paginationMessages,
    pendingActions,
    refreshSource,
    resetListSelection,
    retainedMessageId,
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
  activeThreadId,
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
  const selectionScopeKey = JSON.stringify([
    userId,
    activeMailbox,
    normalizedSearch,
    selectedMailboxes.map((mailbox) => mailbox.id),
  ]);
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
          previous.paginationMessages === state.paginationMessages &&
          previous.retainedMessageId === state.retainedMessageId &&
          previous.activateMessage === state.activateMessage &&
          previous.resetSelection === state.resetSelection &&
          previous.error === state.error &&
          previous.syncError === state.syncError &&
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
      paginationMessages: state?.paginationMessages ?? [],
      retainedMessageId: state?.retainedMessageId ?? null,
    }))
  );
  const visibleEntries = pending ? [] : entries;
  useBriefMailboxActivity(
    visibleEntries,
    activeMessageId === null ||
      (typeof window !== "undefined" &&
        window.matchMedia("(min-width: 1024px)").matches)
  );
  const failedSources = connectedStates.filter(
    ({ state }) => state !== undefined && state.error !== null
  );
  const failedUpdateSources = connectedStates.filter(
    ({ state }) =>
      state !== undefined && state.error === null && state.syncError !== null
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
    for (const { state } of connectedStates) {
      state?.resetSelection();
    }
    const isExcluded = preferences.excludedIds.includes(mailboxId);
    if (
      !isExcluded &&
      mailboxId === activeMailboxId &&
      activeMessageId !== null
    ) {
      onDeactivateActiveMessage();
    }
    const excludedIds = isExcluded
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
    for (const { state } of connectedStates) {
      state?.resetSelection();
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
          <ColorSwatch
            color={color.startsWith("#") ? color : `var(--q-${color})`}
            shape="square"
            size="sm"
          />
        ),
        displayName: mailbox.displayName,
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
      {failedUpdateSources.map(({ mailbox }) => (
        <div
          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-body-sm"
          key={mailbox.id}
        >
          <span>
            Updates for {mailbox.displayName?.trim() || mailbox.emailAddress}{" "}
            could not load. You can still browse its messages.
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
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        {selectedMailboxes.slice(0, 3).map((mailbox) => {
          const color =
            preferences.colors[mailbox.id] ?? defaultMailboxColor(mailbox.id);
          return (
            <IconButtonTooltip
              key={mailbox.id}
              label={`${mailbox.displayName?.trim() || mailbox.emailAddress}, ${mailbox.emailAddress}`}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 text-caption text-muted-fg">
                <ColorSwatch
                  color={color.startsWith("#") ? color : `var(--q-${color})`}
                  shape="square"
                  size="sm"
                />
                <span className="truncate">
                  {mailbox.displayName?.trim() || mailbox.emailAddress}
                </span>
              </span>
            </IconButtonTooltip>
          );
        })}
        {selectedMailboxes.length > 3 && (
          <span className="text-micro text-muted-fg">
            +{selectedMailboxes.length - 3}
          </span>
        )}
        {selectedMailboxes.length === 0 && (
          <span className="text-caption text-muted-fg">All inboxes</span>
        )}
      </div>
      <Popover>
        <PopoverTrigger
          aria-label="Choose inboxes"
          render={<Button size="compact" variant="ghost" />}
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
            activeMessageId={
              mailbox.id === activeMailboxId ? activeMessageId : null
            }
            activeThreadId={
              mailbox.id === activeMailboxId ? activeThreadId : null
            }
            key={mailbox.id}
            mailbox={mailbox}
            onChange={onSourceChange}
            searchQuery={normalizedSearch}
            sourceKey={sourceKey}
            selectionScopeKey={selectionScopeKey}
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
            const sourceKey = JSON.stringify([
              sourceId,
              activeMailbox,
              normalizedSearch,
            ]);
            sourceStates[sourceKey]?.activateMessage(original.id);
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
        onSearch={(nextQuery) => {
          const normalizedQuery = nextQuery.trim();
          for (const { state } of connectedStates) {
            state?.resetSelection();
          }
          onSearch(normalizedQuery);
          if (normalizedQuery === normalizedSearch) {
            void refresh();
          }
        }}
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
