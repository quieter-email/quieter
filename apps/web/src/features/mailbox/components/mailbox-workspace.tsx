"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoadingPage } from "~/components/loading-page";
import { type ComposeDraftState, buildComposeDraftFromSavedDraftMessage } from "~/features/compose";
import { type ComposeDialogHandle, ComposeDialog } from "~/features/compose";
import { useDemoModeEnabled } from "~/features/settings/domain/demo-mode-setting";
import { chatsQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import { createDemoMailboxActions } from "~/lib/gmail/demo-mail";
import { type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import { orpc } from "~/lib/orpc";
import { createMailboxActionHandlers } from "./mailbox-action-handlers";
import { MailboxWorkspaceContent } from "./mailbox-workspace/mailbox-workspace-content";
import { useMailboxMessages } from "./mailbox-workspace/use-mailbox-messages";
import { useMailboxPendingActions } from "./mailbox-workspace/use-mailbox-pending-actions";
import { useMailboxRouteSearch } from "./mailbox-workspace/use-mailbox-route-search";
import { useMailboxSelection } from "./mailbox-workspace/use-mailbox-selection";
import { useWorkspaceUiState } from "./mailbox-workspace/use-workspace-ui-state";

type MailboxWorkspaceProps = {
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

const useChatSidebarActions = ({
  activeChatId,
  chats,
  selectedMailboxId,
  setMailboxSearch,
}: {
  activeChatId: string | undefined;
  chats: RouterOutputs["chat"]["list"];
  selectedMailboxId: string | null;
  setMailboxSearch: ReturnType<typeof useMailboxRouteSearch>["setMailboxSearch"];
}) => {
  const queryClient = useQueryClient();
  const renameChatMutation = useMutation({
    ...orpc.chat.rename.mutationOptions(),
    onSuccess: async (_updatedChat, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getChatQueryKey(variables.chatId) }),
      ]);
    },
  });
  const deleteChatMutation = useMutation({
    ...orpc.chat.delete.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey() }),
        queryClient.removeQueries({ queryKey: getChatQueryKey(variables.chatId) }),
      ]);
    },
  });

  const deleteChat = async (deletedChatId: string) => {
    const nextChatId =
      deletedChatId === activeChatId
        ? (chats.find((existingChat) => existingChat.id !== deletedChatId)?.id ?? null)
        : null;

    await deleteChatMutation.mutateAsync({ chatId: deletedChatId });

    if (deletedChatId === activeChatId) {
      void setMailboxSearch({
        chatId: nextChatId,
        mailboxId: selectedMailboxId,
        view: "chat",
      });
    }
  };

  return {
    deleteChat,
    renameChat: (chatId: string, title: string) =>
      renameChatMutation.mutateAsync({ chatId, title }),
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const queryClient = useQueryClient();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [draftChatVersion, setDraftChatVersion] = useState(0);
  const chatViewLeftAtRef = useRef<number | null>(null);
  const { activeMailbox, chatId, mailboxId, messageId, query, setMailboxSearch, view } =
    useMailboxRouteSearch();
  const chatsQuery = useQuery(chatsQueryOptions());
  const {
    isManualRefreshing,
    isMobileSidebarOpen,
    isWindowActive,
    setIsManualRefreshing,
    setIsMobileSidebarOpen,
    setIsWindowActive,
  } = useWorkspaceUiState();
  const {
    pendingActions,
    pendingMessageActionIdsRef,
    pendingThreadActionIdsRef,
    setMessageActionsPending,
    setThreadActionsPending,
  } = useMailboxPendingActions();
  const isDemoMode = useDemoModeEnabled();
  const {
    defaultMailboxId,
    mailboxGroups,
    mailboxes,
    mailboxesQuery,
    selectedMailboxId,
    setDefaultMailboxMutation,
    updateMailboxSwitcherOrderMutation,
  } = useMailboxSelection({ isDemoMode, mailboxId, queryClient });

  const unsubscribeMutation = useMutation(orpc.mail.unsubscribeFromMessage.mutationOptions());
  const {
    flattenedMessages,
    handleVisibleMessageIdsChange,
    hasMessagePages,
    isLoadingEmptyMessages,
    listState,
    loadMoreMessages,
    messagesPending,
    refreshMessages,
    refreshSearchResultsIfNeeded,
    selectedMessage,
  } = useMailboxMessages({
    activeMailbox,
    isDemoMode,
    isManualRefreshing,
    isWindowActive,
    messageId,
    queryClient,
    searchQuery: query.trim(),
    selectedMailboxId: view === "inbox" ? selectedMailboxId : null,
    setIsManualRefreshing,
  });

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

  useLayoutEffect(() => {
    if (!isDemoMode && mailboxesQuery.isPending) {
      return;
    }

    const normalizedMailboxId = mailboxId?.trim() || null;
    if (normalizedMailboxId === selectedMailboxId) {
      return;
    }

    void setMailboxSearch({
      mailboxId: selectedMailboxId,
      messageId: null,
    });
  }, [isDemoMode, mailboxId, mailboxesQuery.isPending, selectedMailboxId]);

  useLayoutEffect(() => {
    if (
      !selectedMailboxId ||
      !messageId ||
      messagesPending ||
      !hasMessagePages ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxSearch({ messageId: null });
  }, [hasMessagePages, messageId, messagesPending, selectedMessage]);

  const mailboxActions = isDemoMode
    ? createDemoMailboxActions(queryClient)
    : createMailboxActionHandlers({
        activeMailbox,
        activeSearchQuery: query.trim(),
        queryClient,
        refreshSearchResultsIfNeeded,
        isMessageActionPending: (id) => (id ? pendingMessageActionIdsRef.current.has(id) : false),
        isThreadActionPending: (id) => (id ? pendingThreadActionIdsRef.current.has(id) : false),
        setMessageActionPending: (id, pending) => setMessageActionsPending([id], pending),
        setMessageActionsPending,
        setThreadActionPending: (id, pending) => setThreadActionsPending([id], pending),
        setThreadActionsPending,
        unsubscribeFromMessageMutation: async (messageId) => {
          if (!selectedMailboxId) {
            return;
          }

          await unsubscribeMutation.mutateAsync({ mailboxId: selectedMailboxId, messageId });
        },
        mailboxId: selectedMailboxId ?? "",
      });

  const openComposeDraft = (draft: ComposeDraftState) => {
    composeDialogRef.current?.openDraft(draft);
  };

  const openDraft = (message: MessageListItem) => {
    if (!message.draftId) {
      return;
    }

    void setMailboxSearch({ messageId: null });
    openComposeDraft(buildComposeDraftFromSavedDraftMessage(message));
  };

  const activateMessage = (nextMessageId: string) => {
    if (activeMailbox === "drafts") {
      const draftMessage = flattenedMessages.find((message) => message.id === nextMessageId);
      if (draftMessage) {
        openDraft(draftMessage);
      }
      return;
    }

    const shouldPushMobileHistory =
      !messageId && window.matchMedia("(max-width: 1023.98px)").matches;
    void setMailboxSearch({ messageId: nextMessageId }, { replace: !shouldPushMobileHistory });
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === query.trim()) {
      void setMailboxSearch({ messageId: null });
      void refreshMessages();
      return;
    }

    void setMailboxSearch({
      messageId: null,
      query: normalizedQuery || null,
    });
  };

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (mailbox === activeMailbox) return;
    void setMailboxSearch({ mailbox, messageId: null });
  };

  const isMessageRouteOpen = activeMailbox !== "drafts" && !!messageId;
  const chatSidebarActions = useChatSidebarActions({
    activeChatId: chatId,
    chats: chatsQuery.data ?? [],
    selectedMailboxId,
    setMailboxSearch,
  });

  if (!isDemoMode && mailboxesQuery.isPending) {
    return (
      <>
        <LoadingPage />
        <ComposeDialog
          key={selectedMailboxId ?? user.id ?? "signed-out"}
          demoMode={isDemoMode}
          mailboxId={selectedMailboxId}
          ref={composeDialogRef}
        />
      </>
    );
  }

  const currentUserEmail =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId)?.emailAddress ?? null;

  return (
    <>
      <MailboxWorkspaceContent
        activeMailbox={activeMailbox}
        currentUserEmail={currentUserEmail}
        defaultMailboxId={defaultMailboxId}
        layoutState={{
          isLoadingEmptyMessages,
          isMessageRouteOpen,
          isMobileSidebarOpen,
        }}
        chatId={chatId ?? null}
        draftChatKey={`new-chat-${draftChatVersion}`}
        chats={chatsQuery.data ?? []}
        listState={listState}
        mailboxActions={mailboxActions}
        mailboxGroups={mailboxGroups}
        messageId={messageId ?? null}
        onActivateMessage={activateMessage}
        onBackToList={() => {
          void setMailboxSearch({ messageId: null });
        }}
        onComposeDraftRequested={openComposeDraft}
        onComposeNewMail={() => composeDialogRef.current?.openNewMail()}
        onLoadMore={loadMoreMessages}
        onMobileOpenChange={setIsMobileSidebarOpen}
        onOpenDraft={openDraft}
        onOpenSidebar={() => setIsMobileSidebarOpen(true)}
        onRefresh={() => {
          void refreshMessages();
        }}
        onReorderMailboxSwitcher={(order) => {
          updateMailboxSwitcherOrderMutation.mutate(order);
        }}
        onSearch={applySearch}
        onCreateChat={() => {
          setDraftChatVersion((version) => version + 1);
          void setMailboxSearch({
            chatId: null,
            mailboxId: selectedMailboxId,
            view: "chat",
          });
        }}
        onDeleteChat={(deletedChatId) => {
          void chatSidebarActions.deleteChat(deletedChatId);
        }}
        onRenameChat={(renamedChatId, title) => {
          void chatSidebarActions.renameChat(renamedChatId, title);
        }}
        onSelectChat={(nextChatId) => {
          void setMailboxSearch({
            chatId: nextChatId,
            mailboxId: selectedMailboxId,
            view: "chat",
          });
        }}
        onSelectMailbox={selectMailbox}
        onSelectMailboxId={(nextMailboxId) => {
          if (nextMailboxId === selectedMailboxId) return;
          void setMailboxSearch({ mailboxId: nextMailboxId, messageId: null });
        }}
        onSelectView={(nextView) => {
          if (nextView === view) return;
          if (nextView === "chat") {
            const leftAt = chatViewLeftAtRef.current;
            const isStale = leftAt !== null && Date.now() - leftAt > 5 * 60 * 1000;
            const nextChatId = isStale ? null : (chatId ?? chatsQuery.data?.[0]?.id);
            if (isStale) {
              setDraftChatVersion((version) => version + 1);
            }
            void setMailboxSearch({
              chatId: nextChatId ?? null,
              mailboxId: selectedMailboxId,
              view: nextView,
            });
            return;
          }

          chatViewLeftAtRef.current = Date.now();
          void setMailboxSearch({ view: nextView });
        }}
        onChatIdChange={(nextChatId) => {
          void setMailboxSearch({
            chatId: nextChatId,
            mailboxId: selectedMailboxId,
            view: "chat",
          });
        }}
        onSetDefaultMailbox={(nextMailboxId) => {
          void setDefaultMailboxMutation.mutateAsync({ mailboxId: nextMailboxId });
        }}
        onVisibleMessageIdsChange={handleVisibleMessageIdsChange}
        pendingActions={pendingActions}
        searchQuery={query.trim()}
        selectedMailboxId={selectedMailboxId}
        selectedMessage={selectedMessage}
        selectedView={view}
      />
      <ComposeDialog
        key={selectedMailboxId ?? user.id ?? "signed-out"}
        demoMode={isDemoMode}
        mailboxId={selectedMailboxId}
        ref={composeDialogRef}
      />
    </>
  );
};
