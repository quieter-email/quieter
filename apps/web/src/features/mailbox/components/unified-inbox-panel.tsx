"use client";

import { RefreshIcon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { toast } from "@quieter/ui/toast";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SenderAvatar } from "#/components/sender-avatar";
import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import { toastError } from "#/lib/error-toast";
import { formatMessageListDate, parseSender } from "#/lib/gmail/message-utils";
import type { MessageListItem } from "#/lib/mail";
import {
  liveSyncQueryOptions,
  messagesQueryOptions,
} from "#/lib/mail/inbox-query";
import { isMailboxScopeRepairRequiredError } from "#/lib/orpc-errors";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

import {
  buildUnifiedInboxEntries,
  defaultMailboxColor,
  readUnifiedInboxPreferences,
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

type SourceState = {
  messages: MessageListItem[];
  hasNextPage: boolean;
  isPending: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  fetchNextPage: () => Promise<{ error: unknown }>;
  refetch: () => Promise<{ error: unknown }>;
};

type UnifiedInboxPanelProps = {
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
  activeMailboxId: string | null;
  activeMessageId: string | null;
  onReconnectMailbox?: (mailbox: UnifiedInboxMailbox) => void;
};

const UnifiedInboxSource = ({
  sourceKey,
  mailboxId,
  isWindowActive,
  onChange,
  searchQuery,
}: {
  sourceKey: string;
  mailboxId: string;
  isWindowActive: boolean;
  onChange: (sourceKey: string, state: SourceState | null) => void;
  searchQuery: string;
}) => {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery(
    messagesQueryOptions(mailboxId, "inbox", searchQuery)
  );
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch,
  } = query;
  const { error: syncError, refetch: refetchUpdates } = useQuery(
    liveSyncQueryOptions(
      queryClient,
      mailboxId,
      "inbox",
      searchQuery,
      searchQuery.length === 0 &&
        data !== undefined &&
        isWindowActive &&
        !isSandboxMailboxId(mailboxId)
    )
  );
  useEffect(() => {
    const repairError = [error, syncError].find(
      isMailboxScopeRepairRequiredError
    );
    if (repairError !== undefined) {
      markMailboxNeedsReconnectInCache(queryClient, repairError);
    }
  }, [error, syncError, queryClient]);
  const refreshSource = useCallback(async () => {
    const messagesResult = await refetch();
    if (messagesResult.error !== null && messagesResult.error !== undefined) {
      return { error: messagesResult.error };
    }
    if (searchQuery.length > 0 || isSandboxMailboxId(mailboxId)) {
      return { error: null };
    }
    const syncResult = await refetchUpdates();
    return { error: syncResult.error };
  }, [mailboxId, refetch, refetchUpdates, searchQuery]);
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
      messages,
      refetch: refreshSource,
    });
  }, [
    sourceKey,
    onChange,
    messages,
    error,
    syncError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
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
  mailboxes,
  userId,
  searchQuery,
  onSearch,
  onOpenSidebar,
  onSelectMessage,
  activeMailboxId,
  activeMessageId,
  onReconnectMailbox,
}: UnifiedInboxPanelProps) => {
  const isWindowActive = useWindowActive();
  const [savedPreferences, setSavedPreferences] = useState(() => ({
    userId,
    value: readUnifiedInboxPreferences(userId),
  }));
  const preferences =
    savedPreferences.userId === userId
      ? savedPreferences.value
      : readUnifiedInboxPreferences(userId);
  const accessibleMailboxes = mailboxes.filter(
    (mailbox) => mailbox.provider !== "api"
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
  const [searchDraftState, setSearchDraftState] = useState({
    origin: searchQuery,
    value: searchQuery,
  });
  const searchDraft =
    searchDraftState.origin === searchQuery
      ? searchDraftState.value
      : searchQuery;
  const normalizedSearch = searchQuery.trim();
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
          previous.refetch === state.refetch
        ) {
          return current;
        }
        return { ...current, [key]: state };
      });
    },
    []
  );
  const connectedStates = connectedMailboxes.map((mailbox) => ({
    mailbox,
    state: sourceStates[JSON.stringify([mailbox.id, normalizedSearch])],
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
  const mailboxById = new Map(
    accessibleMailboxes.map((mailbox) => [mailbox.id, mailbox])
  );
  const showChooseInbox = selectedMailboxes.length === 0;
  const showLoading = !showChooseInbox && pending;
  const showEmpty = !showChooseInbox && !pending && visibleEntries.length === 0;
  const showEntries = !showChooseInbox && !pending && visibleEntries.length > 0;
  let emptyLabel = "No conversations in these inboxes.";
  if (normalizedSearch) {
    emptyLabel = "No matching conversations.";
  }
  if (hasNextPage) {
    emptyLabel = "Loading older conversations will show more results.";
  }

  const updatePreferences = (next: UnifiedInboxPreferences) => {
    writeUnifiedInboxPreferences(userId, next, accessibleIds);
    setSavedPreferences({ userId, value: next });
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
    if (isRefreshing || connectedMailboxes.length === 0 || pending) {
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
          JSON.stringify([mailboxId, normalizedSearch])
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

  return (
    <section
      aria-label="Combined inbox"
      className="flex h-full min-h-0 flex-col bg-bg"
    >
      {connectedMailboxes.map((mailbox) => {
        const key = JSON.stringify([mailbox.id, normalizedSearch]);
        return (
          <UnifiedInboxSource
            key={key}
            sourceKey={key}
            mailboxId={mailbox.id}
            isWindowActive={isWindowActive}
            onChange={onSourceChange}
            searchQuery={normalizedSearch}
          />
        );
      })}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3 @sm:px-4">
        <div className="lg:hidden">
          <IconButtonTooltip label="Open sidebar">
            <Button
              aria-label="Open sidebar"
              onClick={onOpenSidebar}
              size="icon"
              variant="ghost"
            >
              <HugeiconsIcon icon={SidebarLeftIcon} />
            </Button>
          </IconButtonTooltip>
        </div>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(searchDraft.trim());
          }}
        >
          <Input
            aria-label="Search all inboxes"
            className="min-w-0 flex-1"
            onChange={(event) => {
              setSearchDraftState({
                origin: searchQuery,
                value: event.currentTarget.value,
              });
            }}
            placeholder="Search all inboxes"
            value={searchDraft}
          />
          <Button size="sm" type="submit" variant="outline">
            Search
          </Button>
        </form>
        <IconButtonTooltip label="Refresh inboxes">
          <Button
            aria-label="Refresh inboxes"
            disabled={
              isRefreshing || connectedMailboxes.length === 0 || pending
            }
            onClick={() => {
              void refresh();
            }}
            size="icon"
            variant="ghost"
          >
            <HugeiconsIcon icon={RefreshIcon} />
          </Button>
        </IconButtonTooltip>
      </div>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-body-sm font-semibold text-fg">All inboxes</h2>
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reconnectMailboxes.map((mailbox) => (
          <div
            className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3 text-body-sm"
            key={mailbox.id}
          >
            <span>
              {mailbox.displayName?.trim() || mailbox.emailAddress} needs to be
              reconnected.
            </span>
            {onReconnectMailbox ? (
              <Button
                onClick={() => {
                  onReconnectMailbox(mailbox);
                }}
                size="sm"
                variant="outline"
              >
                Reconnect
              </Button>
            ) : null}
          </div>
        ))}
        {failedSources.map(({ mailbox }) => (
          <div
            className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3 text-body-sm"
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
        {showChooseInbox && (
          <p className="px-4 py-12 text-center text-body-sm text-muted-fg">
            Choose an inbox to show its messages.
          </p>
        )}
        {showLoading && (
          <p
            aria-live="polite"
            className="px-4 py-12 text-center text-body-sm text-muted-fg"
          >
            Loading inboxes…
          </p>
        )}
        {showEmpty && (
          <p className="px-4 py-12 text-center text-body-sm text-muted-fg">
            {emptyLabel}
          </p>
        )}
        {showEntries && (
          <ul className="divide-y divide-border/60">
            {visibleEntries.map(({ mailboxId, thread }) => {
              const mailbox = mailboxById.get(mailboxId);
              if (!mailbox) {
                return null;
              }
              const sender = parseSender(thread.anchorMessage.from);
              const senderLabel =
                sender.name ||
                sender.email ||
                sender.display ||
                "Unknown sender";
              const color =
                preferences.colors[mailboxId] ?? defaultMailboxColor(mailboxId);
              const active =
                activeMailboxId === mailboxId &&
                activeMessageId === thread.anchorMessage.id;
              return (
                <li key={JSON.stringify([mailboxId, thread.threadId])}>
                  <button
                    aria-label={`${thread.subject || "(No subject)"}, from ${senderLabel}, in ${mailbox.emailAddress}`}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40",
                      {
                        "bg-muted/50": active,
                      }
                    )}
                    onClick={() => {
                      onSelectMessage(
                        mailboxId,
                        thread.anchorMessage.id,
                        thread.threadId
                      );
                    }}
                    type="button"
                  >
                    <SenderAvatar
                      avatarUrlDark={
                        thread.anchorMessage.senderAvatarUrls?.dark
                      }
                      avatarUrlLight={
                        thread.anchorMessage.senderAvatarUrls?.light
                      }
                      fallbackLabel={senderLabel.charAt(0).toUpperCase()}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("truncate text-body-sm text-fg", {
                            "font-semibold": thread.unreadCount > 0,
                          })}
                        >
                          {senderLabel}
                        </span>
                        <span className="ml-auto shrink-0 text-caption text-muted-fg">
                          {formatMessageListDate(thread.anchorMessage)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-body-sm text-fg",
                          { "font-medium": thread.unreadCount > 0 }
                        )}
                      >
                        {thread.subject || "(No subject)"}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-caption text-muted-fg">
                        <span className="truncate">{thread.preview}</span>
                        <span
                          className="ml-auto inline-flex max-w-28 shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5"
                          title={mailbox.emailAddress}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              mailboxLabelDotClassNameByColor[color]
                            )}
                          />
                          <span className="truncate">
                            {mailbox.displayName?.trim() ||
                              mailbox.emailAddress}
                          </span>
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {hasNextPage && !pending && selectedMailboxes.length > 0 ? (
          <div className="flex justify-center p-4">
            <Button
              disabled={isFetchingMore}
              onClick={() => {
                void loadMore();
              }}
              size="sm"
              variant="outline"
            >
              {isFetchingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
};
