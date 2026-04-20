"use client";

import {
  Cancel01Icon,
  Delete01Icon,
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  MailOpen02Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Button,
  Checkbox,
  CheckboxIndicator,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButtonTooltip,
  toast,
} from "@quietr/ui";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ListMessagesPageResult, MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import { MessageListSearch } from "~/features/message-search/components/message-list-search";
import { getErrorMessage } from "~/lib/errors";
import { buildThreadListEntries, type ThreadListEntry } from "~/lib/gmail/thread-list";
import { MessageRow } from "./message-row";

type MessageListProps = {
  activeMailbox: MailboxCategory;
  activeMessageId?: string | null;
  mailboxId: string;
  onBulkDeleteDrafts: (threads: ThreadListEntry[]) => void | Promise<void>;
  onBulkDeletePermanently: (threads: ThreadListEntry[]) => void | Promise<void>;
  onBulkMarkAsRead: (threads: ThreadListEntry[]) => void | Promise<void>;
  onBulkMarkAsSpam: (threads: ThreadListEntry[]) => void | Promise<void>;
  onBulkMarkAsUnread: (threads: ThreadListEntry[]) => void | Promise<void>;
  onBulkMoveToTrash: (threads: ThreadListEntry[]) => void | Promise<void>;
  onBulkUnmarkAsSpam: (threads: ThreadListEntry[]) => void | Promise<void>;
  error: Error | null;
  hasNextPage: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  onDeleteDraft: (message: MessageListItem) => void | Promise<void>;
  isMessageActionPending?: (messageId: string) => boolean;
  isThreadActionPending?: (threadId: string) => boolean;
  isPending: boolean;
  isRefreshing: boolean;
  messages: ListMessagesPageResult[];
  onActivateMessage: (messageId: string) => void;
  onDeletePermanently: (messageId: string) => void | Promise<void>;
  onDeleteThreadPermanently: (threadId: string) => void | Promise<void>;
  onLoadMore: () => void;
  onMarkAsRead: (messageId: string) => void | Promise<void>;
  onMarkAsSpam: (messageId: string) => void | Promise<void>;
  onMarkAsUnread: (messageId: string) => void | Promise<void>;
  onMarkThreadAsSpam: (threadId: string) => void | Promise<void>;
  onMoveThreadToTrash: (threadId: string) => void | Promise<void>;
  onMoveToTrash: (messageId: string) => void | Promise<void>;
  onOpenDraft: (message: MessageListItem) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onSearch: (query: string) => void;
  onUntrash: (messageId: string) => void | Promise<void>;
  onUntrashThread: (threadId: string) => void | Promise<void>;
  onUnsubscribe: (messageId: string) => void | Promise<void>;
  onUnmarkAsSpam: (messageId: string) => void | Promise<void>;
  onUnmarkThreadAsSpam: (threadId: string) => void | Promise<void>;
  onUpdateLabels: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  searchQuery: string;
};

const SCROLL_TOP_EPSILON_PX = 2;
const SCROLL_WAIT_TIMEOUT_MS = 600;
const MESSAGE_ROW_HEIGHT_PX = 72;
const MESSAGE_ROW_GAP_PX = 0;
const MESSAGE_LIST_OVERSCAN = 12;

type MessageListScrollPaneProps = Omit<
  MessageListProps,
  | "onBulkDeleteDrafts"
  | "onBulkDeletePermanently"
  | "onBulkMarkAsRead"
  | "onBulkMarkAsSpam"
  | "onBulkMarkAsUnread"
  | "onBulkMoveToTrash"
  | "onBulkUnmarkAsSpam"
  | "onActivateMessage"
> & {
  isProgrammaticScrollToTopRef: RefObject<boolean>;
  isSelectionMode: boolean;
  onThreadPress: (thread: ThreadListEntry, gesture: { additive: boolean; range: boolean }) => void;
  onThreadSelectionPress: (
    thread: ThreadListEntry,
    gesture: { additive: boolean; range: boolean },
  ) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedThreadIds: ReadonlySet<string>;
  threadedMessages: ThreadListEntry[];
  mailboxId: string;
};

const buildDraftListEntry = (message: MessageListItem): ThreadListEntry => ({
  threadId: message.draftId ?? message.id,
  anchorMessage: message,
  messages: [message],
  participants: [],
  subject: message.subject?.trim() || "(No subject)",
  preview: message.snippet?.trim() || "",
  messageCount: 1,
  unreadCount: 0,
});

type MessageListBulkAction = {
  destructive?: boolean;
  icon: IconSvgElement;
  id: string;
  label: string;
  onSelect: () => void | Promise<void>;
};

const MessageListBulkActions = ({
  actions,
  disabled,
}: {
  actions: readonly MessageListBulkAction[];
  disabled: boolean;
}) => (
  <DropdownMenu>
    <IconButtonTooltip label="Bulk actions">
      <DropdownMenuTrigger
        aria-label="Open bulk actions"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-sm transition-colors duration-150 ease-out outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted/80 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0"
        disabled={disabled || actions.length === 0}
        type="button"
      >
        <HugeiconsIcon aria-hidden icon={MoreVerticalIcon} />
      </DropdownMenuTrigger>
    </IconButtonTooltip>

    <DropdownMenuContent align="end">
      {actions.map((action) => (
        <div key={action.id}>
          <DropdownMenuItem
            className={cn({ "text-destructive": action.destructive })}
            onSelect={() => {
              void action.onSelect();
            }}
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={action.icon} />
            <span>{action.label}</span>
          </DropdownMenuItem>
        </div>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

const MessageListSelectionToolbar = ({
  allSelected,
  disabled,
  indeterminate,
  itemLabelPlural,
  onClearSelection,
  onToggleAll,
  selectedCount,
  actions,
}: {
  actions: readonly MessageListBulkAction[];
  allSelected: boolean;
  disabled: boolean;
  indeterminate: boolean;
  itemLabelPlural: string;
  onClearSelection: () => void;
  onToggleAll: (selected: boolean) => void;
  selectedCount: number;
}) => (
  <div className="border-b border-border bg-background-light px-4 py-3">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButtonTooltip label="Select all">
          <Checkbox
            aria-label={`Select all ${itemLabelPlural}`}
            checked={allSelected}
            className="size-[18px] rounded-[5px]"
            disabled={disabled}
            indeterminate={indeterminate}
            onCheckedChange={(checked) => {
              onToggleAll(checked);
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
        </IconButtonTooltip>

        <p className="truncate text-sm font-medium text-foreground">{selectedCount} selected</p>
      </div>

      <div className="flex items-center gap-1">
        <MessageListBulkActions actions={actions} disabled={disabled || selectedCount === 0} />
        <IconButtonTooltip label="Clear selection">
          <Button
            aria-label="Clear selection"
            disabled={disabled}
            onClick={onClearSelection}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>
    </div>
  </div>
);

const MessageListScrollPane = ({
  isProgrammaticScrollToTopRef,
  isSelectionMode,
  scrollRef,
  activeMailbox,
  activeMessageId,
  isThreadActionPending,
  error,
  hasNextPage,
  isError,
  isFetchingNextPage,
  onDeleteDraft,
  isMessageActionPending,
  isPending,
  messages,
  onDeletePermanently,
  onDeleteThreadPermanently,
  onLoadMore,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMarkThreadAsSpam,
  onMoveThreadToTrash,
  onMoveToTrash,
  onOpenDraft,
  onThreadPress,
  onThreadSelectionPress,
  onUntrash,
  onUntrashThread,
  onUnsubscribe,
  onUnmarkAsSpam,
  onUnmarkThreadAsSpam,
  onUpdateLabels,
  selectedThreadIds,
  searchQuery,
  threadedMessages,
  mailboxId,
}: MessageListScrollPaneProps) => {
  const hasViewportAutoPrefetchedRef = useRef(false);
  const flattenedMessages = messages.flatMap((page) => page.messages);
  const threadedMessageIds = threadedMessages.map((thread) => thread.threadId);
  const messageThreadIds = new Map(
    flattenedMessages.map((message) => [message.id, message.threadId] as const),
  );
  const activeThreadId = activeMessageId ? (messageThreadIds.get(activeMessageId) ?? null) : null;

  const messageVirtualizer = useVirtualizer({
    count: threadedMessages.length,
    estimateSize: () => MESSAGE_ROW_HEIGHT_PX,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => threadedMessageIds[index] ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: MESSAGE_LIST_OVERSCAN,
  });

  const tryLoadMore = () => {
    if (!hasNextPage || isFetchingNextPage || isPending || isError) return;
    onLoadMore();
  };

  const shouldPrefetch = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    const threshold = Math.max(element.clientHeight, 400);
    return distanceToBottom <= threshold;
  };

  const maybeLoadMore = () => {
    if (!scrollRef.current) return;
    if (!shouldPrefetch(scrollRef.current)) return;
    tryLoadMore();
  };

  useLayoutEffect(() => {
    if (
      threadedMessages.length === 0 ||
      !scrollRef.current ||
      hasViewportAutoPrefetchedRef.current
    ) {
      return;
    }

    hasViewportAutoPrefetchedRef.current = true;
    maybeLoadMore();
  }, [threadedMessages.length]);

  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 contain-strict"
      onScroll={() => {
        if (isProgrammaticScrollToTopRef.current) return;
        maybeLoadMore();
      }}
      ref={scrollRef}
    >
      {isPending && threadedMessages.length === 0 ? (
        <div className="grid place-items-center px-2 py-8">
          <HugeiconsIcon className="animate-spin text-muted-foreground" icon={Loading03Icon} />
        </div>
      ) : null}

      {isError ? <p className="px-2 py-8 text-sm text-destructive">{error?.message}</p> : null}

      {!isError && threadedMessages.length > 0 ? (
        <ul
          className="relative"
          style={{
            height: `${messageVirtualizer.getTotalSize()}px`,
          }}
        >
          {messageVirtualizer.getVirtualItems().map((virtualItem) => {
            const thread = threadedMessages[virtualItem.index];

            return thread ? (
              <MessageRow
                activeMailbox={activeMailbox}
                className="absolute top-0 left-0 w-full"
                dataIndex={virtualItem.index}
                isActionPending={
                  isMessageActionPending?.(thread.anchorMessage.id) ||
                  isThreadActionPending?.(thread.threadId)
                }
                isActive={activeThreadId === thread.threadId}
                isSelected={selectedThreadIds.has(thread.threadId)}
                isSelectionMode={isSelectionMode}
                key={thread.threadId}
                onDeleteDraft={onDeleteDraft}
                onDeletePermanently={onDeletePermanently}
                onDeleteThreadPermanently={onDeleteThreadPermanently}
                onMarkAsRead={onMarkAsRead}
                onMarkAsSpam={onMarkAsSpam}
                onMarkAsUnread={onMarkAsUnread}
                onMarkThreadAsSpam={onMarkThreadAsSpam}
                onMoveThreadToTrash={onMoveThreadToTrash}
                onMoveToTrash={onMoveToTrash}
                onOpenDraft={onOpenDraft}
                onPress={onThreadPress}
                onSelectionPress={onThreadSelectionPress}
                onUntrash={onUntrash}
                onUntrashThread={onUntrashThread}
                onUnsubscribe={onUnsubscribe}
                onUnmarkAsSpam={onUnmarkAsSpam}
                onUnmarkThreadAsSpam={onUnmarkThreadAsSpam}
                onUpdateLabels={onUpdateLabels}
                style={{
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                thread={thread}
                mailboxId={mailboxId}
              />
            ) : null;
          })}
        </ul>
      ) : null}

      {!isPending && !isError && threadedMessages.length === 0 ? (
        <p className="px-2 py-8 text-sm text-muted-foreground">
          {activeMailbox === "drafts"
            ? searchQuery
              ? "No drafts found."
              : "No drafts."
            : searchQuery
              ? "No messages found."
              : "No messages."}
        </p>
      ) : null}

      {!isError && threadedMessages.length > 0 ? (
        <p className="px-2 py-5 text-center text-xs text-muted-foreground">
          {isFetchingNextPage || hasNextPage ? (
            <HugeiconsIcon
              className="mx-auto animate-spin text-muted-foreground"
              icon={Loading03Icon}
            />
          ) : (
            "You're all caught up."
          )}
        </p>
      ) : null}
    </div>
  );
};

const useMessageListSelection = ({
  activeMailbox,
  activeThreadId,
  onActivateMessage,
  searchQuery,
  threadedMessages,
}: {
  activeMailbox: MailboxCategory;
  activeThreadId: string | null;
  onActivateMessage: (messageId: string) => void;
  searchQuery: string;
  threadedMessages: ThreadListEntry[];
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollToTopRef = useRef(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [selectionAnchorThreadId, setSelectionAnchorThreadId] = useState<string | null>(null);
  const loadedThreadIds = threadedMessages.map((thread) => thread.threadId);
  const threadById = new Map(threadedMessages.map((thread) => [thread.threadId, thread] as const));
  const loadedThreadIndexById = new Map(
    loadedThreadIds.map((threadId, index) => [threadId, index] as const),
  );
  const selectedThreads = Array.from(selectedThreadIds)
    .map((threadId) => threadById.get(threadId))
    .filter((thread): thread is ThreadListEntry => Boolean(thread));
  const selectedCount = selectedThreadIds.size;
  const totalCount = threadedMessages.length;
  const isSelectionMode = selectedCount > 0;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const selectionIndeterminate = selectedCount > 0 && !allSelected;

  const waitForSmoothScrollTop = async (element: HTMLDivElement) => {
    await new Promise<void>((resolve) => {
      let done = false;

      const cleanup = () => {
        element.removeEventListener("scroll", onScroll);
        element.removeEventListener("scrollend", onScrollEnd as EventListener);
        clearTimeout(timeoutId);
      };

      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const onScroll = () => {
        if (element.scrollTop <= SCROLL_TOP_EPSILON_PX) finish();
      };

      const onScrollEnd = () => finish();
      const timeoutId = setTimeout(finish, SCROLL_WAIT_TIMEOUT_MS);

      element.addEventListener("scroll", onScroll, { passive: true });

      if ("onscrollend" in element) {
        element.addEventListener("scrollend", onScrollEnd as EventListener, { passive: true });
      }

      if (element.scrollTop <= SCROLL_TOP_EPSILON_PX) finish();
    });
  };

  const waitForNextPaint = async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  };

  const scrollListToTop = () => {
    if (!scrollRef.current || scrollRef.current.scrollTop <= SCROLL_TOP_EPSILON_PX) {
      return false;
    }

    isProgrammaticScrollToTopRef.current = true;

    const scrollElement = scrollRef.current;
    scrollElement.scrollTo({ top: 0, behavior: "smooth" });
    void waitForSmoothScrollTop(scrollElement)
      .then(() => waitForNextPaint())
      .finally(() => {
        isProgrammaticScrollToTopRef.current = false;
      });

    return true;
  };

  useEffect(() => {
    setSelectedThreadIds(new Set());
    setSelectionAnchorThreadId(null);
  }, [activeMailbox, searchQuery]);

  useEffect(() => {
    const loadedThreadIdSet = new Set(loadedThreadIds);
    setSelectedThreadIds((current) => {
      const nextSelectedIds = Array.from(current).filter((threadId) =>
        loadedThreadIdSet.has(threadId),
      );
      return nextSelectedIds.length === current.size ? current : new Set(nextSelectedIds);
    });
    setSelectionAnchorThreadId((current) =>
      current && loadedThreadIdSet.has(current) ? current : null,
    );
  }, [loadedThreadIds]);

  const clearSelection = () => {
    setSelectedThreadIds(new Set());
    setSelectionAnchorThreadId(null);
  };

  const selectSingleThread = (threadId: string) => {
    setSelectedThreadIds(new Set([threadId]));
    setSelectionAnchorThreadId(threadId);
  };

  const toggleThreadSelection = (threadId: string) => {
    setSelectedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
    setSelectionAnchorThreadId(threadId);
  };

  const startAdditiveSelection = (threadId: string) => {
    setSelectedThreadIds(() => {
      const next = new Set<string>();

      if (activeThreadId && loadedThreadIndexById.has(activeThreadId)) {
        next.add(activeThreadId);
      }

      next.add(threadId);
      return next;
    });
    setSelectionAnchorThreadId(threadId);
  };

  const selectThreadRange = (threadId: string, additive: boolean) => {
    const targetIndex = loadedThreadIndexById.get(threadId);
    const fallbackAnchorThreadId =
      selectionAnchorThreadId ??
      (activeThreadId && loadedThreadIndexById.has(activeThreadId) ? activeThreadId : null);
    const anchorIndex = fallbackAnchorThreadId
      ? loadedThreadIndexById.get(fallbackAnchorThreadId)
      : undefined;

    if (targetIndex == null) return;

    setSelectedThreadIds((current) => {
      if (anchorIndex == null) {
        if (additive) {
          const next = new Set(current);

          if (activeThreadId && loadedThreadIndexById.has(activeThreadId)) {
            next.add(activeThreadId);
          }

          next.add(threadId);
          return next;
        }

        return new Set([threadId]);
      }

      const next = additive ? new Set(current) : new Set<string>();
      const startIndex = Math.min(anchorIndex, targetIndex);
      const endIndex = Math.max(anchorIndex, targetIndex);

      for (let index = startIndex; index <= endIndex; index += 1) {
        const rangeThreadId = loadedThreadIds[index];
        if (rangeThreadId) {
          next.add(rangeThreadId);
        }
      }

      return next;
    });
    setSelectionAnchorThreadId(threadId);
  };

  const toggleAllLoadedThreads = (selected: boolean) => {
    setSelectedThreadIds(selected ? new Set(loadedThreadIds) : new Set());
    setSelectionAnchorThreadId(selected ? (loadedThreadIds[0] ?? null) : null);
  };

  const handleThreadSelectionPress = (
    thread: ThreadListEntry,
    gesture: { additive: boolean; range: boolean },
  ) => {
    if (gesture.range) {
      selectThreadRange(thread.threadId, gesture.additive);
      return;
    }

    if (!isSelectionMode && gesture.additive) {
      startAdditiveSelection(thread.threadId);
      return;
    }

    if (!isSelectionMode && !gesture.additive) {
      selectSingleThread(thread.threadId);
      return;
    }

    toggleThreadSelection(thread.threadId);
  };

  const handleThreadPress = (
    thread: ThreadListEntry,
    gesture: { additive: boolean; range: boolean },
  ) => {
    if (gesture.range) {
      selectThreadRange(thread.threadId, gesture.additive);
      return;
    }

    if (!isSelectionMode && gesture.additive) {
      startAdditiveSelection(thread.threadId);
      return;
    }

    if (isSelectionMode && !gesture.additive) {
      toggleThreadSelection(thread.threadId);
      return;
    }

    if (gesture.additive) {
      toggleThreadSelection(thread.threadId);
      return;
    }

    setSelectionAnchorThreadId(thread.threadId);
    onActivateMessage(thread.anchorMessage.id);
  };

  useHotkey(
    "Mod+A",
    () => {
      toggleAllLoadedThreads(true);
    },
    {
      enabled: totalCount > 0,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    },
  );

  useHotkey(
    "Escape",
    () => {
      clearSelection();
    },
    {
      enabled: isSelectionMode,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    },
  );

  return {
    allSelected,
    clearSelection,
    handleThreadPress,
    handleThreadSelectionPress,
    isProgrammaticScrollToTopRef,
    isSelectionMode,
    scrollListToTop,
    scrollRef,
    selectedCount,
    selectedThreadIds,
    selectedThreads,
    selectionIndeterminate,
    toggleAllLoadedThreads,
  };
};

export const MessageList = ({
  activeMailbox,
  activeMessageId,
  mailboxId,
  onBulkDeleteDrafts,
  onBulkDeletePermanently,
  onBulkMarkAsRead,
  onBulkMarkAsSpam,
  onBulkMarkAsUnread,
  onBulkMoveToTrash,
  onBulkUnmarkAsSpam,
  error,
  hasNextPage,
  isError,
  isFetchingNextPage,
  onDeleteDraft,
  isMessageActionPending,
  isThreadActionPending,
  isPending,
  isRefreshing,
  messages,
  onSearch,
  onActivateMessage,
  onDeletePermanently,
  onDeleteThreadPermanently,
  onLoadMore,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMarkThreadAsSpam,
  onMoveThreadToTrash,
  onMoveToTrash,
  onOpenDraft,
  onRefresh,
  onUpdateLabels,
  onUntrash,
  onUntrashThread,
  onUnsubscribe,
  onUnmarkAsSpam,
  onUnmarkThreadAsSpam,
  searchQuery,
}: MessageListProps) => {
  const flattenedMessages = messages.flatMap((page) => page.messages);
  const threadedMessages =
    activeMailbox === "drafts"
      ? flattenedMessages.map((message) => buildDraftListEntry(message))
      : buildThreadListEntries(flattenedMessages);
  const messageThreadIds = new Map(
    flattenedMessages.map((message) => {
      return [message.id, message.threadId] as const;
    }),
  );
  const activeThreadId =
    activeMailbox === "drafts" || !activeMessageId
      ? null
      : (messageThreadIds.get(activeMessageId) ?? null);
  const {
    allSelected,
    clearSelection,
    handleThreadPress,
    handleThreadSelectionPress,
    isProgrammaticScrollToTopRef,
    isSelectionMode,
    scrollListToTop,
    scrollRef,
    selectedCount,
    selectedThreadIds,
    selectedThreads,
    selectionIndeterminate,
    toggleAllLoadedThreads,
  } = useMessageListSelection({
    activeMailbox,
    activeThreadId,
    onActivateMessage,
    searchQuery,
    threadedMessages,
  });
  const isBulkActionPending = selectedThreads.some(
    (thread) =>
      isMessageActionPending?.(thread.anchorMessage.id) || isThreadActionPending?.(thread.threadId),
  );

  const runBulkAction = async (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    fallbackMessage: string,
  ) => {
    if (selectedThreads.length === 0) return;

    try {
      await action(selectedThreads);
    } catch (error) {
      toast.error(getErrorMessage(error, fallbackMessage));
    }
  };

  const bulkActions: MessageListBulkAction[] =
    activeMailbox === "drafts"
      ? [
          {
            destructive: true,
            icon: Delete02Icon,
            id: "delete-drafts",
            label: "Delete drafts",
            onSelect: async () => {
              await runBulkAction(onBulkDeleteDrafts, "Could not delete those drafts.");
            },
          },
        ]
      : [
          {
            icon: MailOpen02Icon,
            id: "mark-threads-read",
            label: "Mark as Read",
            onSelect: async () => {
              await runBulkAction(onBulkMarkAsRead, "Could not mark those conversations as read.");
            },
          },
          {
            icon: Mail01Icon,
            id: "mark-threads-unread",
            label: "Mark as Unread",
            onSelect: async () => {
              await runBulkAction(
                onBulkMarkAsUnread,
                "Could not mark those conversations as unread.",
              );
            },
          },
          ...(activeMailbox === "inbox"
            ? [
                {
                  destructive: true,
                  icon: Delete02Icon,
                  id: "mark-threads-spam",
                  label: "Mark as Spam",
                  onSelect: async () => {
                    await runBulkAction(
                      onBulkMarkAsSpam,
                      "Could not move those conversations to spam.",
                    );
                  },
                } satisfies MessageListBulkAction,
              ]
            : []),
          ...(activeMailbox === "spam"
            ? [
                {
                  icon: Mail01Icon,
                  id: "unmark-threads-spam",
                  label: "Unmark as Spam",
                  onSelect: async () => {
                    await runBulkAction(
                      onBulkUnmarkAsSpam,
                      "Could not remove those conversations from spam.",
                    );
                  },
                } satisfies MessageListBulkAction,
              ]
            : []),
          {
            destructive: true,
            icon: activeMailbox === "trash" ? Delete02Icon : Delete01Icon,
            id: activeMailbox === "trash" ? "delete-threads" : "move-threads-trash",
            label: activeMailbox === "trash" ? "Delete permanently" : "Move to Trash",
            onSelect: async () => {
              await runBulkAction(
                activeMailbox === "trash" ? onBulkDeletePermanently : onBulkMoveToTrash,
                activeMailbox === "trash"
                  ? "Could not delete those conversations."
                  : "Could not move those conversations to trash.",
              );
            },
          },
        ];

  const scrollPaneKey = `${activeMailbox}:${searchQuery}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isSelectionMode ? (
        <MessageListSelectionToolbar
          actions={bulkActions}
          allSelected={allSelected}
          disabled={isPending || isBulkActionPending}
          indeterminate={selectionIndeterminate}
          itemLabelPlural={activeMailbox === "drafts" ? "drafts" : "conversations"}
          onClearSelection={clearSelection}
          onToggleAll={toggleAllLoadedThreads}
          selectedCount={selectedCount}
        />
      ) : (
        <MessageListSearch
          isRefreshing={isRefreshing}
          mailboxId={mailboxId}
          onRefresh={onRefresh}
          onScrollToTop={scrollListToTop}
          onSearch={onSearch}
          searchQuery={searchQuery}
        />
      )}

      <MessageListScrollPane
        key={scrollPaneKey}
        isProgrammaticScrollToTopRef={isProgrammaticScrollToTopRef}
        isSelectionMode={isSelectionMode}
        scrollRef={scrollRef}
        activeMailbox={activeMailbox}
        activeMessageId={activeMessageId}
        error={error}
        hasNextPage={hasNextPage}
        isError={isError}
        isFetchingNextPage={isFetchingNextPage}
        onDeleteDraft={onDeleteDraft}
        isMessageActionPending={isMessageActionPending}
        isThreadActionPending={isThreadActionPending}
        isPending={isPending}
        isRefreshing={isRefreshing}
        messages={messages}
        onDeletePermanently={onDeletePermanently}
        onDeleteThreadPermanently={onDeleteThreadPermanently}
        onLoadMore={onLoadMore}
        onMarkAsRead={onMarkAsRead}
        onMarkAsSpam={onMarkAsSpam}
        onMarkAsUnread={onMarkAsUnread}
        onMarkThreadAsSpam={onMarkThreadAsSpam}
        onMoveThreadToTrash={onMoveThreadToTrash}
        onMoveToTrash={onMoveToTrash}
        onOpenDraft={onOpenDraft}
        onRefresh={onRefresh}
        onSearch={onSearch}
        onThreadPress={handleThreadPress}
        onThreadSelectionPress={handleThreadSelectionPress}
        onUntrash={onUntrash}
        onUntrashThread={onUntrashThread}
        onUnsubscribe={onUnsubscribe}
        onUnmarkAsSpam={onUnmarkAsSpam}
        onUnmarkThreadAsSpam={onUnmarkThreadAsSpam}
        onUpdateLabels={onUpdateLabels}
        selectedThreadIds={selectedThreadIds}
        searchQuery={searchQuery}
        threadedMessages={threadedMessages}
        mailboxId={mailboxId}
      />
    </div>
  );
};
