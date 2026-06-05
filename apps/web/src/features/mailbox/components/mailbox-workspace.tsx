"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { ComposeDraftState } from "~/features/compose";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { LoadingPage } from "~/components/loading-page";
import { type ComposeDialogHandle, ComposeDialog } from "~/features/compose";
import { useDemoModeEnabled } from "~/features/settings/domain/demo-mode-setting";
import { chatsQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import {
  getGoogleLinkCallbackURL,
  openGoogleAccountLink,
  readPendingGmailLink,
  writePendingGmailLink,
  type PendingGmailLinkState,
} from "~/lib/google-account-link";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import type { MailboxWorkspaceView } from "../domain/mailbox-workspace-view";
import { MailboxWorkspaceContent } from "./mailbox-workspace/mailbox-workspace-content";
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
    onMutate: () => ({ mailboxId: selectedMailboxId }),
    onSuccess: async (_updatedChat, variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey(context.mailboxId) }),
        queryClient.invalidateQueries({
          queryKey: getChatQueryKey(context.mailboxId, variables.chatId),
        }),
      ]);
    },
  });
  const deleteChatMutation = useMutation({
    ...orpc.chat.delete.mutationOptions(),
    onMutate: () => ({ mailboxId: selectedMailboxId }),
    onSuccess: async (_result, variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey(context.mailboxId) }),
        queryClient.removeQueries({
          queryKey: getChatQueryKey(context.mailboxId, variables.chatId),
        }),
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

const getCurrentCallbackURL = () => {
  if (typeof window === "undefined") {
    return "/";
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const queryClient = useQueryClient();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [draftChatVersion, setDraftChatVersion] = useState(0);
  const [gmailReconnectError, setGmailReconnectError] = useState<string | null>(null);
  const [pendingGmailLink, setPendingGmailLink] = useState<PendingGmailLinkState | null>(() =>
    readPendingGmailLink(),
  );
  const [startingReconnectMailboxId, setStartingReconnectMailboxId] = useState<string | null>(null);
  const chatViewLeftAtRef = useRef<number | null>(null);
  const { activeMailbox, chatId, mailboxId, query, setMailboxSearch, view } =
    useMailboxRouteSearch();
  const { isMobileSidebarOpen, setIsMobileSidebarOpen } = useWorkspaceUiState();
  const isDemoMode = useDemoModeEnabled();
  const {
    defaultMailboxId,
    mailboxGroups,
    mailboxes,
    mailboxesQuery,
    selectedMailboxId,
    selectedMailboxNeedsReconnect,
    setDefaultMailboxMutation,
    updateMailboxSwitcherOrderMutation,
  } = useMailboxSelection({ isDemoMode, mailboxId, queryClient });
  const chatsQuery = useQuery(chatsQueryOptions(selectedMailboxId));
  const reconnectingMailboxId =
    startingReconnectMailboxId ??
    (pendingGmailLink?.mode === "reconnect" ? (pendingGmailLink.mailboxId ?? null) : null);
  useQuery({
    enabled: pendingGmailLink?.mode === "reconnect" && pendingGmailLink.readyToFinalize === true,
    queryKey: ["mailboxes", "finish-gmail-link", pendingGmailLink?.startedAt],
    queryFn: async () => {
      if (!pendingGmailLink || pendingGmailLink.mode !== "reconnect") {
        return null;
      }

      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });

      const result = await mailboxesQuery.refetch({
        cancelRefetch: true,
      });

      if (result.isError) {
        writePendingGmailLink(null);
        setPendingGmailLink(null);
        setStartingReconnectMailboxId(null);
        toast.error("Could not finish Google reconnect.");
        return result;
      }

      writePendingGmailLink(null);
      setPendingGmailLink(null);
      setStartingReconnectMailboxId(null);

      const reconnectedMailbox = result.data?.groups
        .flatMap((group) => group.mailboxes)
        .find((mailbox) => mailbox.id === pendingGmailLink.mailboxId);

      if (reconnectedMailbox?.connectionStatus === "connected") {
        toast.success("Google reconnected.");
        return result;
      }

      setGmailReconnectError("Google did not reconnect that account. Try again and choose it.");
      return result;
    },
  });

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
  }, [isDemoMode, mailboxId, mailboxesQuery.isPending, selectedMailboxId, setMailboxSearch]);

  const openComposeDraft = (draft: ComposeDraftState) => {
    composeDialogRef.current?.openDraft(draft);
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === query.trim()) {
      void setMailboxSearch({ messageId: null });
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

  const selectView = (nextView: MailboxWorkspaceView) => {
    if (nextView === view) return;
    if (nextView === "chat") {
      const leftAt = chatViewLeftAtRef.current;
      const isStale = leftAt !== null && performance.now() - leftAt > 5 * 60 * 1000;
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

    chatViewLeftAtRef.current = performance.now();
    void setMailboxSearch({ view: nextView });
  };

  const chatSidebarActions = useChatSidebarActions({
    activeChatId: chatId,
    chats: chatsQuery.data ?? [],
    selectedMailboxId,
    setMailboxSearch,
  });
  const reconnectMailbox = async (mailbox: { emailAddress: string; id: string }) => {
    setGmailReconnectError(null);

    const nextPendingGmailLink = {
      mailboxCount: mailboxes.length,
      mailboxId: mailbox.id,
      mode: "reconnect",
      readyToFinalize: false,
      startedAt: Date.now(),
    } satisfies PendingGmailLinkState;

    writePendingGmailLink(nextPendingGmailLink);
    setPendingGmailLink(nextPendingGmailLink);
    setStartingReconnectMailboxId(mailbox.id);

    try {
      await openGoogleAccountLink({
        callbackURL: getGoogleLinkCallbackURL(getCurrentCallbackURL()),
        loginHint: mailbox.emailAddress,
      });
    } catch (error) {
      writePendingGmailLink(null);
      setPendingGmailLink(null);
      setStartingReconnectMailboxId(null);
      setGmailReconnectError(
        (error as { message?: string })?.message ?? "Could not start Google reconnect.",
      );
    }
  };

  const isWorkspaceReady = isDemoMode || !mailboxesQuery.isPending;

  if (!isWorkspaceReady) {
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

  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;
  const currentUserEmail = selectedMailbox?.emailAddress ?? null;

  return (
    <>
      <MailboxWorkspaceContent
        activeMailbox={activeMailbox}
        currentUserEmail={currentUserEmail}
        defaultMailboxId={defaultMailboxId}
        layoutState={{
          isMobileSidebarOpen,
        }}
        chatId={chatId ?? null}
        draftChatKey={`new-chat-${draftChatVersion}`}
        isDemoMode={isDemoMode}
        chats={chatsQuery.data ?? []}
        mailboxGroups={mailboxGroups}
        onComposeDraftRequested={openComposeDraft}
        onComposeNewMail={() => composeDialogRef.current?.openNewMail()}
        onMobileOpenChange={setIsMobileSidebarOpen}
        onOpenSidebar={() => setIsMobileSidebarOpen(true)}
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
        onReconnectMailbox={(reconnectedMailbox) => {
          void reconnectMailbox(reconnectedMailbox);
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
        onSelectView={selectView}
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
        reconnectError={gmailReconnectError}
        reconnectingMailboxId={reconnectingMailboxId}
        searchQuery={query.trim()}
        selectedMailboxId={selectedMailboxId}
        selectedMailboxNeedsReconnect={selectedMailboxNeedsReconnect}
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
