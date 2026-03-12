"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useQueryStates } from "nuqs";
import { useEffect, useState } from "react";
import { type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import {
  deleteMessagePermanentlyInMailbox,
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  markMessageAsReadInMailbox,
  markMessageAsUnreadInMailbox,
  markThreadAsReadInMailbox,
  markThreadAsUnreadInMailbox,
  messagesQueryOptions,
  moveMessageToTrashInMailbox,
  refreshLoadedMessagesPages,
  updateMessageLabelsInMailbox,
} from "~/lib/gmail/inbox-query";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { mailboxSearchParams } from "~/lib/search-params";
import { ComposeDialog } from "./compose-dialog";
import { MailSidebar } from "./mail-sidebar";
import { MessageDetail } from "./message-detail";
import { MessageList } from "./message-list";

type MailboxWorkspaceProps = {
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isWindowActive, setIsWindowActive] = useState(false);
  const [composeRequestId, setComposeRequestId] = useState(0);
  const [pendingMessageActionIds, setPendingMessageActionIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pendingThreadActionIds, setPendingThreadActionIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [{ mailbox: activeMailbox, messageId: activeMessageId }, setMailboxQuery] = useQueryStates(
    mailboxSearchParams,
    {
      history: "replace",
      scroll: false,
    },
  );

  const messagesQuery = useInfiniteQuery(messagesQueryOptions(queryClient, activeMailbox));
  const hasLoadedMessages = Boolean(messagesQuery.data?.pages.length);
  const isLiveSyncEnabled =
    pathname === "/" && isWindowActive && hasLoadedMessages && !isManualRefreshing;
  const syncQuery = useQuery(liveSyncQueryOptions(queryClient, activeMailbox, isLiveSyncEnabled));

  const flattenedMessages = messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [];

  const refreshMessages = async () => {
    const liveSyncQueryKey = getLiveSyncQueryKey(activeMailbox);
    const messagesQueryKey = getMessagesQueryKey(activeMailbox);

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);
    try {
      await refreshLoadedMessagesPages(queryClient, activeMailbox);
    } finally {
      setIsManualRefreshing(false);
    }
  };

  let selectedMessage: MessageListItem | null = null;
  if (activeMessageId) {
    for (const message of flattenedMessages) {
      if (message.id === activeMessageId) {
        selectedMessage = message;
        break;
      }
    }
  }

  useEffect(() => {
    const updateWindowActivity = () => {
      setIsWindowActive(document.visibilityState === "visible" && document.hasFocus());
    };

    updateWindowActivity();
    window.addEventListener("focus", updateWindowActivity);
    window.addEventListener("blur", updateWindowActivity);
    document.addEventListener("visibilitychange", updateWindowActivity);

    return () => {
      window.removeEventListener("focus", updateWindowActivity);
      window.removeEventListener("blur", updateWindowActivity);
      document.removeEventListener("visibilitychange", updateWindowActivity);
    };
  }, []);

  useEffect(() => {
    if (isLiveSyncEnabled) return;

    void queryClient.cancelQueries({ queryKey: getLiveSyncQueryKey(activeMailbox) });
  }, [activeMailbox, isLiveSyncEnabled, queryClient]);

  useEffect(() => {
    if (
      !activeMessageId ||
      messagesQuery.isPending ||
      !messagesQuery.data?.pages.length ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxQuery({ messageId: null });
  }, [
    activeMessageId,
    messagesQuery.data,
    messagesQuery.isPending,
    selectedMessage,
    setMailboxQuery,
  ]);

  const isMessageActionPending = (messageId: string | null | undefined) =>
    messageId ? pendingMessageActionIds.has(messageId) : false;

  const isThreadActionPending = (threadId: string | null | undefined) =>
    threadId ? pendingThreadActionIds.has(threadId) : false;

  const setMessageActionPending = (messageId: string, pending: boolean) => {
    setPendingMessageActionIds((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  };

  const setThreadActionPending = (threadId: string, pending: boolean) => {
    setPendingThreadActionIds((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(threadId);
      } else {
        next.delete(threadId);
      }
      return next;
    });
  };

  const runMessageAction = async (messageId: string, action: () => Promise<void>) => {
    if (isMessageActionPending(messageId)) return;

    setMessageActionPending(messageId, true);
    try {
      await action();
    } finally {
      setMessageActionPending(messageId, false);
    }
  };

  const runThreadAction = async (threadId: string, action: () => Promise<void>) => {
    if (isThreadActionPending(threadId)) return;

    setThreadActionPending(threadId, true);
    try {
      await action();
    } finally {
      setThreadActionPending(threadId, false);
    }
  };

  const activateMessage = (messageId: string) => {
    if (activeMessageId === messageId) return;
    const threadId = flattenedMessages.find((message) => message.id === messageId)?.threadId;

    void setMailboxQuery({ messageId });

    if (threadId) {
      void queryClient.prefetchQuery(getThreadWithDetailsOptions(activeMailbox, threadId));
    }
  };

  const loadMoreMessages = () => {
    if (
      !messagesQuery.hasNextPage ||
      messagesQuery.isFetchingNextPage ||
      messagesQuery.isPending ||
      messagesQuery.isError
    ) {
      return;
    }

    void messagesQuery.fetchNextPage();
  };

  const markMessageAsRead = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsReadInMailbox(queryClient, activeMailbox, messageId);
    });
  };

  const markMessageAsUnread = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsUnreadInMailbox(queryClient, activeMailbox, messageId);
    });
  };

  const markThreadAsRead = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsReadInMailbox(queryClient, activeMailbox, threadId);
    });
  };

  const markThreadAsUnread = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsUnreadInMailbox(queryClient, activeMailbox, threadId);
    });
  };

  const updateMessageLabels = async (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => {
    await runMessageAction(messageId, async () => {
      await updateMessageLabelsInMailbox(queryClient, activeMailbox, messageId, changes);
    });
  };

  const moveMessageToTrash = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await moveMessageToTrashInMailbox(queryClient, activeMailbox, messageId);
    });
  };

  const deleteMessagePermanently = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await deleteMessagePermanentlyInMailbox(queryClient, activeMailbox, messageId);
    });
  };

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (mailbox === activeMailbox) return;
    void setMailboxQuery({ mailbox, messageId: null });
  };

  return (
    <>
      <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0" />

          <MailSidebar
            onComposeNewMail={() => setComposeRequestId((current) => current + 1)}
            onSelectMailbox={selectMailbox}
            selectedMailbox={activeMailbox}
            user={user}
          />

          <div className="relative flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
            <section className="flex min-h-0 min-w-0 flex-col border-r border-border bg-background-light">
              <MessageList
                activeMailbox={activeMailbox}
                activeMessageId={activeMessageId}
                error={messagesQuery.error ?? null}
                hasNextPage={Boolean(messagesQuery.hasNextPage)}
                isError={messagesQuery.isError}
                isFetchingNextPage={messagesQuery.isFetchingNextPage}
                isMessageActionPending={isMessageActionPending}
                isPending={messagesQuery.isPending}
                isRefreshing={
                  isManualRefreshing ||
                  syncQuery.isFetching ||
                  (messagesQuery.isRefetching && !messagesQuery.isFetchingNextPage)
                }
                messages={messagesQuery.data?.pages ?? []}
                onActivateMessage={activateMessage}
                onDeletePermanently={(messageId) => {
                  void deleteMessagePermanently(messageId);
                }}
                onLoadMore={loadMoreMessages}
                onMarkAsRead={(messageId) => {
                  void markMessageAsRead(messageId);
                }}
                onMarkAsUnread={(messageId) => {
                  void markMessageAsUnread(messageId);
                }}
                onMoveToTrash={(messageId) => {
                  void moveMessageToTrash(messageId);
                }}
                onRefresh={() => {
                  void refreshMessages();
                }}
                onUpdateLabels={(messageId, changes) => {
                  void updateMessageLabels(messageId, changes);
                }}
              />
            </section>

            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
              <MessageDetail
                activeMailbox={activeMailbox}
                isActionPending={
                  isMessageActionPending(selectedMessage?.id) ||
                  isThreadActionPending(selectedMessage?.threadId)
                }
                onDeletePermanently={(messageId) => {
                  void deleteMessagePermanently(messageId);
                }}
                onMarkAsRead={(messageId) => {
                  void markMessageAsRead(messageId);
                }}
                onMarkAsUnread={(messageId) => {
                  void markMessageAsUnread(messageId);
                }}
                onMarkThreadAsRead={(threadId) => {
                  void markThreadAsRead(threadId);
                }}
                onMarkThreadAsUnread={(threadId) => {
                  void markThreadAsUnread(threadId);
                }}
                onMoveToTrash={(messageId) => {
                  void moveMessageToTrash(messageId);
                }}
                onUpdateLabels={(messageId, changes) => {
                  void updateMessageLabels(messageId, changes);
                }}
                selectedMessage={selectedMessage}
              />
            </div>
          </div>
        </div>

        <ComposeDialog
          composeRequestId={composeRequestId}
          queryClient={queryClient}
          userId={user.id ?? null}
        />
      </main>

      <footer className="fixed right-4 bottom-4 px-3 py-1.5 text-[10px] text-muted-foreground">
        <a
          className="transition-colors hover:text-foreground"
          href="https://logo.dev"
          target="_blank"
          title="Logo API"
        >
          Logos provided by Logo.dev
        </a>
      </footer>
    </>
  );
};
