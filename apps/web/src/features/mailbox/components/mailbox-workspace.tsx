"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { useHotkey, useHotkeySequence } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { LoadingPage } from "~/components/loading-page";
import { parseMailtoComposeDraft, type ComposeDraftState } from "~/features/compose";
import { type ComposeDialogHandle, ComposeDialog } from "~/features/compose";
import { shouldIgnoreAppShortcut } from "~/features/hotkeys/domain/hotkey-guards";
import { useDemoModeEnabled } from "~/features/settings/domain/demo-mode-setting";
import { useManagedDemoModeEnabled } from "~/features/settings/domain/managed-demo-mode-setting";
import { chatsQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import { openGoogleAccountLink } from "~/lib/google-account-link";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { usePreviewPersona } from "~/lib/preview-personas";
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

const isMailboxSupportedByProvider = (
  provider: "api" | "gmail" | "managed" | null,
  mailbox: MailboxCategory,
) => {
  if (provider === "api") return mailbox === "sent";
  return true;
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
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey(variables.mailboxId) }),
        queryClient.invalidateQueries({
          queryKey: getChatQueryKey(variables.mailboxId, variables.chatId),
        }),
      ]);
    },
  });
  const deleteChatMutation = useMutation({
    ...orpc.chat.delete.mutationOptions(),
    onSuccess: async (_result, variables) => {
      queryClient.removeQueries({
        queryKey: getChatQueryKey(variables.mailboxId, variables.chatId),
      });
      await queryClient.invalidateQueries({ queryKey: getChatsQueryKey(variables.mailboxId) });
    },
  });

  const deleteChat = async (deletedChatId: string) => {
    if (!selectedMailboxId) return;

    const nextChatId =
      deletedChatId === activeChatId
        ? (chats.find((existingChat) => existingChat.id !== deletedChatId)?.id ?? null)
        : null;

    await deleteChatMutation.mutateAsync({
      chatId: deletedChatId,
      mailboxId: selectedMailboxId,
    });

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
    renameChat: (chatId: string, title: string) => {
      if (!selectedMailboxId) return;
      return renameChatMutation.mutateAsync({ chatId, mailboxId: selectedMailboxId, title });
    },
  };
};

export const MailboxWorkspace = ({ user }: MailboxWorkspaceProps) => {
  const queryClient = useQueryClient();
  const composeDialogRef = useRef<ComposeDialogHandle | null>(null);
  const [draftChatVersion, setDraftChatVersion] = useState(0);
  const [gmailReconnectError, setGmailReconnectError] = useState<string | null>(null);
  const [isStartingGmailConnection, setIsStartingGmailConnection] = useState(false);
  const [startingReconnectMailboxId, setStartingReconnectMailboxId] = useState<string | null>(null);
  const chatViewLeftAtRef = useRef<number | null>(null);
  const launchedMailtoRef = useRef<string | null>(null);
  const {
    activeMailbox,
    chatId,
    compose,
    gmailLink,
    mailboxId,
    mailto,
    messageId,
    query,
    setMailboxSearch,
    threadId,
    view,
  } = useMailboxRouteSearch();
  const { isMobileSidebarOpen, setIsMobileSidebarOpen } = useWorkspaceUiState();
  const isDemoMode = useDemoModeEnabled();
  const isManagedDemoMode = useManagedDemoModeEnabled();
  const previewPersona = usePreviewPersona();
  const isEmptyPreviewPersona = previewPersona === "empty";
  const isSandboxMode = isDemoMode || isManagedDemoMode || isEmptyPreviewPersona;
  const {
    defaultMailboxId,
    mailboxGroups,
    mailboxes,
    mailboxesQuery,
    selectedMailboxId,
    selectedMailboxProvider,
    selectedMailboxNeedsReconnect,
    setDefaultMailboxMutation,
    updateMailboxSwitcherOrderMutation,
  } = useMailboxSelection({
    isDemoMode,
    isEmptyPreviewPersona,
    isManagedDemoMode,
    mailboxId,
    queryClient,
  });
  const { data: chats = [], isPending: areChatsPending } = useQuery(
    chatsQueryOptions(
      isSandboxMode || selectedMailboxProvider === "api" ? null : selectedMailboxId,
    ),
  );
  const reconnectingMailboxId = startingReconnectMailboxId;
  const isCompletingGmailConnection = gmailLink === "complete" && !isSandboxMode;
  const isWorkspaceReady =
    isSandboxMode || (!mailboxesQuery.isPending && !isCompletingGmailConnection);

  useEffect(() => {
    if (!isCompletingGmailConnection) return;

    let cancelled = false;
    void queryClient
      .refetchQueries({
        exact: true,
        queryKey: getMailboxesQueryKey(),
        type: "active",
      })
      .then(() => {
        if (!cancelled) {
          void setMailboxSearch({ mailboxId });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isCompletingGmailConnection, mailboxId, queryClient, setMailboxSearch]);

  useLayoutEffect(() => {
    if (isCompletingGmailConnection || (!isSandboxMode && mailboxesQuery.isPending)) {
      return;
    }

    const normalizedMailboxId = mailboxId?.trim() || null;
    if (
      normalizedMailboxId === selectedMailboxId &&
      (selectedMailboxId || (view === "inbox" && !chatId))
    ) {
      return;
    }

    void setMailboxSearch({
      chatId: normalizedMailboxId === selectedMailboxId && selectedMailboxId ? undefined : null,
      mailboxId: selectedMailboxId,
      messageId: null,
      view: selectedMailboxId ? undefined : "inbox",
    });
  }, [
    chatId,
    isCompletingGmailConnection,
    isDemoMode,
    isManagedDemoMode,
    isSandboxMode,
    mailboxId,
    mailboxesQuery.isPending,
    selectedMailboxId,
    setMailboxSearch,
    view,
  ]);

  useLayoutEffect(() => {
    if (view !== "chat" || !selectedMailboxId || areChatsPending) return;

    if (chatId && !chats.some((existingChat) => existingChat.id === chatId)) {
      void setMailboxSearch({
        chatId: chats[0]?.id ?? null,
        mailboxId: selectedMailboxId,
        view: "chat",
      });
    }
  }, [areChatsPending, chatId, chats, selectedMailboxId, setMailboxSearch, view]);

  useLayoutEffect(() => {
    if (selectedMailboxProvider === "api" && view === "chat") {
      void setMailboxSearch({ chatId: null, view: "inbox" });
    }
  }, [selectedMailboxProvider, setMailboxSearch, view]);

  useLayoutEffect(() => {
    if (isMailboxSupportedByProvider(selectedMailboxProvider, activeMailbox)) return;

    void setMailboxSearch({
      mailbox: selectedMailboxProvider === "api" ? "sent" : "inbox",
      messageId: null,
    });
  }, [activeMailbox, selectedMailboxProvider, setMailboxSearch]);

  useLayoutEffect(() => {
    if (compose !== "mailto" || !mailto) {
      launchedMailtoRef.current = null;
      return;
    }

    if (!isWorkspaceReady) {
      return;
    }

    if (!selectedMailboxId) {
      launchedMailtoRef.current = mailto;
      void setMailboxSearch({ compose: null, mailto: null }, { replace: true });
      return;
    }

    if (launchedMailtoRef.current === mailto) {
      return;
    }

    launchedMailtoRef.current = mailto;
    const draft = parseMailtoComposeDraft(mailto);
    void setMailboxSearch({ compose: null, mailto: null }, { replace: true });

    if (draft) {
      composeDialogRef.current?.openDraft(draft);
    }
  }, [compose, isWorkspaceReady, mailto, selectedMailboxId, setMailboxSearch]);

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
      const nextChatId = isStale ? null : (chatId ?? chats[0]?.id);
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
  const selectMailboxFromHotkey = (mailbox: MailboxCategory) => {
    if (!isMailboxSupportedByProvider(selectedMailboxProvider, mailbox)) return;

    selectMailbox(mailbox);
  };

  const chatSidebarActions = useChatSidebarActions({
    activeChatId: chatId,
    chats,
    selectedMailboxId,
    setMailboxSearch,
  });
  const reconnectMailbox = async (mailbox: { emailAddress: string; id: string }) => {
    setGmailReconnectError(null);
    setStartingReconnectMailboxId(mailbox.id);

    try {
      await openGoogleAccountLink({
        mailboxId: mailbox.id,
        queryClient,
        returnTo:
          `${window.location.pathname}${window.location.search}${window.location.hash}` || "/",
      });
    } catch (error) {
      setStartingReconnectMailboxId(null);
      setGmailReconnectError(
        (error as { message?: string })?.message ?? "Could not start Google reconnect.",
      );
    }
  };
  const connectGmail = async () => {
    setGmailReconnectError(null);
    setIsStartingGmailConnection(true);

    try {
      await openGoogleAccountLink({
        queryClient,
        returnTo:
          `${window.location.pathname}${window.location.search}${window.location.hash}` || "/",
      });
    } catch (error) {
      setIsStartingGmailConnection(false);
      setGmailReconnectError(
        error instanceof Error ? error.message : "Could not start Gmail connection.",
      );
    }
  };

  useHotkey(
    "C",
    (event) => {
      if (
        !selectedMailboxId ||
        selectedMailboxProvider === "api" ||
        shouldIgnoreAppShortcut(event)
      ) {
        return;
      }
      composeDialogRef.current?.openNewMail();
    },
    {
      enabled: isWorkspaceReady,
      ignoreInputs: true,
    },
  );

  useHotkeySequence(
    ["G", "I"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectMailboxFromHotkey("inbox");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );
  useHotkeySequence(
    ["G", "T"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectMailboxFromHotkey("sent");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );
  useHotkeySequence(
    ["G", "D"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectMailboxFromHotkey("drafts");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );
  useHotkeySequence(
    ["G", "U"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectMailboxFromHotkey("unread");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );
  useHotkeySequence(
    ["G", "S"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectMailboxFromHotkey("spam");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );
  useHotkeySequence(
    ["G", "R"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectMailboxFromHotkey("trash");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );
  useHotkeySequence(
    ["G", "H"],
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      selectView("chat");
    },
    { enabled: isWorkspaceReady && !!selectedMailboxId, ignoreInputs: true },
  );

  if (!isWorkspaceReady) {
    return (
      <>
        <LoadingPage />
        <ComposeDialog
          key={selectedMailboxId ?? user.id ?? "signed-out"}
          demoMode={isDemoMode}
          managedDemoMode={isManagedDemoMode}
          mailboxId={selectedMailboxId}
          persistDrafts={selectedMailboxProvider !== "api"}
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
        chatContext={
          messageId || threadId || query.trim()
            ? {
                messageId,
                query: query.trim() || undefined,
                threadId,
              }
            : undefined
        }
        currentUserEmail={currentUserEmail}
        defaultMailboxId={defaultMailboxId}
        layoutState={{
          isMobileSidebarOpen,
        }}
        chatId={chatId ?? null}
        draftChatKey={`new-chat-${draftChatVersion}`}
        isConnectingGmail={isStartingGmailConnection}
        isDemoMode={isDemoMode}
        isManagedDemoMode={isManagedDemoMode}
        chats={chats}
        mailboxGroups={mailboxGroups}
        onConnectGmail={() => {
          void connectGmail();
        }}
        onComposeDraftRequested={openComposeDraft}
        onComposeNewMail={() => {
          if (selectedMailboxProvider !== "api") {
            composeDialogRef.current?.openNewMail();
          }
        }}
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
        onReconnectMailbox={reconnectMailbox}
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
          const nextMailboxProvider = mailboxes.find(
            (availableMailbox) => availableMailbox.id === nextMailboxId,
          )?.provider;
          void setMailboxSearch({
            chatId: view === "chat" || nextMailboxProvider === "api" ? null : undefined,
            mailbox: nextMailboxProvider === "api" ? "sent" : undefined,
            mailboxId: nextMailboxId,
            messageId: null,
            view: nextMailboxProvider === "api" ? "inbox" : undefined,
            query: nextMailboxProvider !== selectedMailboxProvider ? null : undefined,
          });
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
        selectedMailboxProvider={selectedMailboxProvider}
        selectedMailboxNeedsReconnect={selectedMailboxNeedsReconnect}
        selectedView={view}
      />
      <ComposeDialog
        key={selectedMailboxId ?? user.id ?? "signed-out"}
        demoMode={isDemoMode}
        managedDemoMode={isManagedDemoMode}
        mailboxId={selectedMailboxId}
        persistDrafts={!isManagedDemoMode && selectedMailboxProvider !== "api"}
        ref={composeDialogRef}
      />
    </>
  );
};
