"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { useHotkey, useHotkeySequence } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { LoadingPage } from "#/components/loading-page";
import { setPendingComposeSession } from "#/features/compose/domain/compose-session";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { parseMailtoComposeDraft } from "#/features/compose/domain/mailto";
import { shouldIgnoreAppShortcut } from "#/features/hotkeys/domain/hotkey-guards";
import { useDemoModeEnabled } from "#/features/settings/domain/demo-mode-setting";
import { useManagedDemoModeEnabled } from "#/features/settings/domain/managed-demo-mode-setting";
import {
  chatsQueryOptions,
  getChatQueryKey,
  getChatsQueryKey,
} from "#/lib/chat-query";
import type { MailboxCategory } from "#/lib/gmail/gmail";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";
import { getErrorMessage } from "#/lib/orpc-errors";
import { usePreviewPersona } from "#/lib/preview-personas";

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
  mailbox: MailboxCategory
) => {
  if (provider === "api") {
    return mailbox === "sent";
  }
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
  setMailboxSearch: ReturnType<
    typeof useMailboxRouteSearch
  >["setMailboxSearch"];
}) => {
  const queryClient = useQueryClient();
  const renameChatMutation = useMutation({
    ...orpc.chat.rename.mutationOptions(),
    onSuccess: async (_updatedChat, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getChatsQueryKey(variables.mailboxId),
        }),
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
      await queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(variables.mailboxId),
      });
    },
  });

  const deleteChat = async (deletedChatId: string) => {
    if (selectedMailboxId === null || selectedMailboxId === "") {
      return;
    }

    const nextChatId =
      deletedChatId === activeChatId
        ? (chats.find((existingChat) => existingChat.id !== deletedChatId)
            ?.id ?? null)
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
    renameChat: async (chatId: string, title: string) => {
      if (selectedMailboxId === null || selectedMailboxId === "") {
        return;
      }
      await renameChatMutation.mutateAsync({
        chatId,
        mailboxId: selectedMailboxId,
        title,
      });
    },
  };
};

type SetMailboxSearch = ReturnType<
  typeof useMailboxRouteSearch
>["setMailboxSearch"];
type MailboxProvider = "api" | "gmail" | "managed" | null;

const useMailboxWorkspaceCompose = ({
  activeMailbox,
  isComposeMailbox,
  isTemplateMailbox,
  setMailboxSearch,
}: {
  activeMailbox: MailboxCategory;
  isComposeMailbox: boolean;
  isTemplateMailbox: boolean;
  setMailboxSearch: SetMailboxSearch;
}) => {
  const [composeSessionKey, setComposeSessionKey] = useState(0);
  const composeReturnMailboxRef = useRef<MailboxCategory>("inbox");
  const launchedMailtoRef = useRef<string | null>(null);

  const openComposeWorkspace = useCallback(
    (draft: ComposeDraftState | null) => {
      const returnMailbox =
        isComposeMailbox || isTemplateMailbox
          ? composeReturnMailboxRef.current
          : activeMailbox;
      composeReturnMailboxRef.current = returnMailbox;
      setPendingComposeSession({ draft, returnMailbox });
      setComposeSessionKey((key) => key + 1);
      void setMailboxSearch({
        mailbox: "compose",
        messageId: null,
        threadId: null,
        view: "inbox",
      });
    },
    [activeMailbox, isComposeMailbox, isTemplateMailbox, setMailboxSearch]
  );

  const closeComposeWorkspace = () => {
    void setMailboxSearch({
      mailbox: composeReturnMailboxRef.current,
      messageId: null,
      threadId: null,
      view: "inbox",
    });
  };

  return {
    closeComposeWorkspace,
    composeSessionKey,
    launchedMailtoRef,
    openComposeWorkspace,
  };
};

const useMailboxWorkspaceRouteEffects = ({
  activeMailbox,
  areChatsPending,
  chatId,
  chats,
  compose,
  isCompletingGmailConnection,
  isComposeMailbox,
  isSandboxMode,
  isTemplateMailbox,
  isWorkspaceReady,
  launchedMailtoRef,
  mailboxId,
  mailto,
  mailboxesPending,
  openComposeWorkspace,
  queryClient,
  selectedMailboxId,
  selectedMailboxProvider,
  setMailboxSearch,
  view,
}: {
  activeMailbox: MailboxCategory;
  areChatsPending: boolean;
  chatId: string | null | undefined;
  chats: RouterOutputs["chat"]["list"];
  compose: string | null | undefined;
  isCompletingGmailConnection: boolean;
  isComposeMailbox: boolean;
  isSandboxMode: boolean;
  isTemplateMailbox: boolean;
  isWorkspaceReady: boolean;
  launchedMailtoRef: { current: string | null };
  mailboxId: string | null | undefined;
  mailto: string | null | undefined;
  mailboxesPending: boolean;
  openComposeWorkspace: (draft: ComposeDraftState | null) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  selectedMailboxId: string | null;
  selectedMailboxProvider: MailboxProvider;
  setMailboxSearch: SetMailboxSearch;
  view: MailboxWorkspaceView;
}) => {
  useEffect((): (() => void) | undefined => {
    if (!isCompletingGmailConnection) {
      return undefined;
    }

    let cancelled = false;
    const refetchMailboxes = async () => {
      try {
        await queryClient.refetchQueries({
          exact: true,
          queryKey: getMailboxesQueryKey(),
          type: "active",
        });
        if (!cancelled) {
          void setMailboxSearch({ mailboxId });
        }
      } catch {
        // The mailbox query exposes its own error state.
      }
    };
    void refetchMailboxes();

    return () => {
      cancelled = true;
    };
  }, [isCompletingGmailConnection, mailboxId, queryClient, setMailboxSearch]);

  useLayoutEffect(() => {
    if (isCompletingGmailConnection || (!isSandboxMode && mailboxesPending)) {
      return;
    }

    const trimmedMailboxId = mailboxId?.trim();
    const normalizedMailboxId =
      trimmedMailboxId === undefined || trimmedMailboxId === ""
        ? null
        : trimmedMailboxId;
    if (
      normalizedMailboxId === selectedMailboxId &&
      ((selectedMailboxId !== null && selectedMailboxId !== "") ||
        (view === "inbox" &&
          (chatId === null || chatId === undefined || chatId === "")))
    ) {
      return;
    }

    void setMailboxSearch({
      chatId:
        normalizedMailboxId === selectedMailboxId &&
        selectedMailboxId !== null &&
        selectedMailboxId !== ""
          ? undefined
          : null,
      mailboxId: selectedMailboxId,
      messageId: null,
      view:
        selectedMailboxId !== null && selectedMailboxId !== ""
          ? undefined
          : "inbox",
    });
  }, [
    chatId,
    isCompletingGmailConnection,
    isSandboxMode,
    mailboxId,
    mailboxesPending,
    selectedMailboxId,
    setMailboxSearch,
    view,
  ]);

  useLayoutEffect(() => {
    if (
      view !== "chat" ||
      selectedMailboxId === null ||
      selectedMailboxId === "" ||
      areChatsPending
    ) {
      return;
    }

    if (
      chatId !== null &&
      chatId !== undefined &&
      chatId !== "" &&
      !chats.some((existingChat) => existingChat.id === chatId)
    ) {
      void setMailboxSearch({
        chatId: chats[0]?.id ?? null,
        mailboxId: selectedMailboxId,
        view: "chat",
      });
    }
  }, [
    areChatsPending,
    chatId,
    chats,
    selectedMailboxId,
    setMailboxSearch,
    view,
  ]);

  useLayoutEffect(() => {
    if (selectedMailboxProvider === "api" && view === "chat") {
      void setMailboxSearch({ chatId: null, view: "inbox" });
    }
  }, [selectedMailboxProvider, setMailboxSearch, view]);

  useLayoutEffect(() => {
    if (isComposeMailbox || isTemplateMailbox) {
      return;
    }
    if (isMailboxSupportedByProvider(selectedMailboxProvider, activeMailbox)) {
      return;
    }

    void setMailboxSearch({
      mailbox: selectedMailboxProvider === "api" ? "sent" : "inbox",
      messageId: null,
    });
  }, [
    activeMailbox,
    isComposeMailbox,
    isTemplateMailbox,
    selectedMailboxProvider,
    setMailboxSearch,
  ]);

  useLayoutEffect(() => {
    if (
      compose !== "mailto" ||
      mailto === null ||
      mailto === undefined ||
      mailto === ""
    ) {
      launchedMailtoRef.current = null;
      return;
    }

    if (!isWorkspaceReady) {
      return;
    }

    if (
      selectedMailboxId === null ||
      selectedMailboxId === undefined ||
      selectedMailboxId === ""
    ) {
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
      openComposeWorkspace(draft);
    }
  }, [
    compose,
    isWorkspaceReady,
    launchedMailtoRef,
    mailto,
    openComposeWorkspace,
    selectedMailboxId,
    setMailboxSearch,
  ]);
};

const useMailboxWorkspaceActions = ({
  activeMailbox,
  chatId,
  chats,
  isComposeMailbox,
  isTemplateMailbox,
  mailboxes,
  openComposeWorkspace,
  query,
  queryClient,
  selectedMailboxId,
  selectedMailboxProvider,
  setMailboxSearch,
  view,
}: {
  activeMailbox: MailboxCategory;
  chatId: string | null | undefined;
  chats: RouterOutputs["chat"]["list"];
  isComposeMailbox: boolean;
  isTemplateMailbox: boolean;
  mailboxes: { id: string; provider: string }[];
  openComposeWorkspace: (draft: ComposeDraftState | null) => void;
  query: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  selectedMailboxId: string | null;
  selectedMailboxProvider: MailboxProvider;
  setMailboxSearch: SetMailboxSearch;
  view: MailboxWorkspaceView;
}) => {
  const [draftChatKey, setDraftChatKey] = useState(() => crypto.randomUUID());
  const chatViewLeftAtRef = useRef<number | null>(null);
  const [gmailReconnectError, setGmailReconnectError] = useState<string | null>(
    null
  );
  const [isStartingGmailConnection, setIsStartingGmailConnection] =
    useState(false);
  const [startingReconnectMailboxId, setStartingReconnectMailboxId] = useState<
    string | null
  >(null);

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === (query ?? "").trim()) {
      void setMailboxSearch({ messageId: null });
      return;
    }

    void setMailboxSearch({
      messageId: null,
      query: normalizedQuery === "" ? null : normalizedQuery,
    });
  };

  const selectMailbox = (mailbox: MailboxCategory) => {
    if (
      !isTemplateMailbox &&
      !isComposeMailbox &&
      mailbox === activeMailbox &&
      view === "inbox"
    ) {
      return;
    }
    void setMailboxSearch({ mailbox, messageId: null, view: "inbox" });
  };

  const selectView = (nextView: MailboxWorkspaceView) => {
    if (nextView === view) {
      return;
    }
    if (nextView === "chat") {
      const leftAt = chatViewLeftAtRef.current;
      const isStale =
        leftAt !== null && performance.now() - leftAt > 5 * 60 * 1000;
      const nextChatId = isStale ? null : (chatId ?? chats[0]?.id);
      if (isStale) {
        setDraftChatKey(crypto.randomUUID());
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
    if (!isMailboxSupportedByProvider(selectedMailboxProvider, mailbox)) {
      return;
    }
    selectMailbox(mailbox);
  };

  const reconnectMailbox = async (mailbox: {
    emailAddress: string;
    id: string;
  }) => {
    setGmailReconnectError(null);
    setStartingReconnectMailboxId(mailbox.id);

    try {
      await openGoogleAccountLink({
        mailboxId: mailbox.id,
        queryClient,
        returnTo:
          `${window.location.pathname}${window.location.search}${window.location.hash}` ||
          "/",
      });
    } catch (error) {
      setStartingReconnectMailboxId(null);
      setGmailReconnectError(
        getErrorMessage(error, "Could not start Google reconnect.")
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
          `${window.location.pathname}${window.location.search}${window.location.hash}` ||
          "/",
      });
    } catch (error) {
      setIsStartingGmailConnection(false);
      setGmailReconnectError(
        getErrorMessage(error, "Could not start Gmail connection.")
      );
    }
  };

  const createChat = () => {
    setDraftChatKey(crypto.randomUUID());
    void setMailboxSearch({
      chatId: null,
      mailboxId: selectedMailboxId,
      view: "chat",
    });
  };

  const selectChat = (nextChatId: string) => {
    void setMailboxSearch({
      chatId: nextChatId,
      mailboxId: selectedMailboxId,
      view: "chat",
    });
  };

  const changeChatId = (nextChatId: string | null) => {
    void setMailboxSearch({
      chatId: nextChatId,
      mailboxId: selectedMailboxId,
      view: "chat",
    });
  };

  const selectMailboxId = (nextMailboxId: string) => {
    if (nextMailboxId === selectedMailboxId) {
      return;
    }
    const nextMailboxProvider = mailboxes.find(
      (availableMailbox) => availableMailbox.id === nextMailboxId
    )?.provider;
    if (view === "chat") {
      setDraftChatKey(crypto.randomUUID());
    }
    void setMailboxSearch({
      chatId:
        view === "chat" || nextMailboxProvider === "api" ? null : undefined,
      mailbox: nextMailboxProvider === "api" ? "sent" : undefined,
      mailboxId: nextMailboxId,
      messageId: null,
      query: nextMailboxProvider === selectedMailboxProvider ? undefined : null,
      view: nextMailboxProvider === "api" ? "inbox" : undefined,
    });
  };

  const createComposeDraft = () => {
    if (selectedMailboxProvider !== "api") {
      openComposeWorkspace(null);
    }
  };

  const manageTemplates = () => {
    void setMailboxSearch({
      mailbox: "template",
      messageId: null,
      threadId: null,
      view: "inbox",
    });
  };

  return {
    applySearch,
    changeChatId,
    connectGmail,
    createChat,
    createComposeDraft,
    draftChatKey,
    gmailReconnectError,
    isStartingGmailConnection,
    manageTemplates,
    reconnectMailbox,
    reconnectingMailboxId: startingReconnectMailboxId,
    selectChat,
    selectMailbox,
    selectMailboxFromHotkey,
    selectMailboxId,
    selectView,
  };
};

const useMailboxWorkspaceHotkeys = ({
  isWorkspaceReady,
  openComposeWorkspace,
  selectMailboxFromHotkey,
  selectView,
  selectedMailboxId,
  selectedMailboxProvider,
}: {
  isWorkspaceReady: boolean;
  openComposeWorkspace: (draft: ComposeDraftState | null) => void;
  selectMailboxFromHotkey: (mailbox: MailboxCategory) => void;
  selectView: (view: MailboxWorkspaceView) => void;
  selectedMailboxId: string | null;
  selectedMailboxProvider: MailboxProvider;
}) => {
  const enabled = isWorkspaceReady && selectedMailboxId !== null;

  useHotkey(
    "C",
    (event) => {
      if (
        selectedMailboxId === null ||
        selectedMailboxProvider === "api" ||
        shouldIgnoreAppShortcut(event)
      ) {
        return;
      }
      openComposeWorkspace(null);
    },
    { enabled: isWorkspaceReady, ignoreInputs: true }
  );

  useHotkeySequence(
    ["G", "I"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("inbox");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "T"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("sent");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "A"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("archive");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "D"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("drafts");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "U"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("unread");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "S"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("spam");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "R"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectMailboxFromHotkey("trash");
      }
    },
    { enabled, ignoreInputs: true }
  );
  useHotkeySequence(
    ["G", "H"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        selectView("chat");
      }
    },
    { enabled, ignoreInputs: true }
  );
};

type MailboxWorkspaceContentProps = ComponentProps<
  typeof MailboxWorkspaceContent
>;
type MailboxWorkspaceBodyProps = Omit<
  MailboxWorkspaceContentProps,
  | "activeMailbox"
  | "chatContext"
  | "currentUserEmail"
  | "draftChatKey"
  | "persistComposeDrafts"
  | "searchQuery"
  | "signature"
> & {
  activeMailbox: MailboxCategory;
  draftChatKey: string;
  isTemplateMailbox: boolean;
  messageId: string | undefined;
  query: string;
  selectedMailbox: {
    emailAddress: string;
    signatureHtml: string | null;
    signatureText: string | null;
  } | null;
  threadId: string | undefined;
};

const MailboxWorkspaceBody = ({
  activeMailbox,
  draftChatKey,
  isComposeMailbox,
  isManagedDemoMode,
  isTemplateMailbox,
  messageId,
  query,
  selectedMailbox,
  threadId,
  ...contentProps
}: MailboxWorkspaceBodyProps) => {
  const normalizedChatQuery = query.trim();
  const hasMessageId =
    messageId !== undefined && messageId !== null && messageId !== "";
  const hasThreadId =
    threadId !== undefined && threadId !== null && threadId !== "";

  return (
    <MailboxWorkspaceContent
      {...contentProps}
      activeMailbox={
        isTemplateMailbox || isComposeMailbox ? null : activeMailbox
      }
      chatContext={
        hasMessageId || hasThreadId || normalizedChatQuery !== ""
          ? {
              messageId,
              query:
                normalizedChatQuery === "" ? undefined : normalizedChatQuery,
              threadId,
            }
          : undefined
      }
      draftChatKey={draftChatKey}
      isComposeMailbox={isComposeMailbox}
      isManagedDemoMode={isManagedDemoMode}
      persistComposeDrafts={
        !isManagedDemoMode && contentProps.selectedMailboxProvider !== "api"
      }
      searchQuery={normalizedChatQuery}
      signature={
        selectedMailbox
          ? {
              html: selectedMailbox.signatureHtml,
              text: selectedMailbox.signatureText,
            }
          : undefined
      }
      currentUserEmail={selectedMailbox?.emailAddress ?? null}
    />
  );
};

export const MailboxWorkspace = ({ user: _user }: MailboxWorkspaceProps) => {
  const queryClient = useQueryClient();
  const {
    activeMailbox,
    chatId,
    compose,
    gmailLink,
    isComposeMailbox,
    isTemplateMailbox,
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
  const isSandboxMode =
    isDemoMode || isManagedDemoMode || isEmptyPreviewPersona;
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
      isSandboxMode || selectedMailboxProvider === "api"
        ? null
        : selectedMailboxId
    )
  );
  const isCompletingGmailConnection =
    gmailLink === "complete" && !isSandboxMode;
  const isWorkspaceReady =
    isSandboxMode ||
    (!mailboxesQuery.isPending && !isCompletingGmailConnection);

  const composeWorkspace = useMailboxWorkspaceCompose({
    activeMailbox,
    isComposeMailbox,
    isTemplateMailbox,
    setMailboxSearch,
  });
  const chatSidebarActions = useChatSidebarActions({
    activeChatId: chatId,
    chats,
    selectedMailboxId,
    setMailboxSearch,
  });
  const workspaceActions = useMailboxWorkspaceActions({
    activeMailbox,
    chatId,
    chats,
    isComposeMailbox,
    isTemplateMailbox,
    mailboxes,
    openComposeWorkspace: composeWorkspace.openComposeWorkspace,
    query,
    queryClient,
    selectedMailboxId,
    selectedMailboxProvider,
    setMailboxSearch,
    view,
  });

  useMailboxWorkspaceRouteEffects({
    activeMailbox,
    areChatsPending,
    chatId,
    chats,
    compose,
    isCompletingGmailConnection,
    isComposeMailbox,
    isSandboxMode,
    isTemplateMailbox,
    isWorkspaceReady,
    launchedMailtoRef: composeWorkspace.launchedMailtoRef,
    mailboxId,
    mailboxesPending: mailboxesQuery.isPending,
    mailto,
    openComposeWorkspace: composeWorkspace.openComposeWorkspace,
    queryClient,
    selectedMailboxId,
    selectedMailboxProvider,
    setMailboxSearch,
    view,
  });

  useMailboxWorkspaceHotkeys({
    isWorkspaceReady,
    openComposeWorkspace: composeWorkspace.openComposeWorkspace,
    selectMailboxFromHotkey: workspaceActions.selectMailboxFromHotkey,
    selectView: workspaceActions.selectView,
    selectedMailboxId,
    selectedMailboxProvider,
  });

  const {
    applySearch,
    changeChatId,
    connectGmail,
    createChat,
    createComposeDraft,
    draftChatKey,
    gmailReconnectError,
    isStartingGmailConnection,
    manageTemplates,
    reconnectMailbox,
    reconnectingMailboxId,
    selectChat,
    selectMailbox,
    selectMailboxId,
    selectView,
  } = workspaceActions;
  const {
    closeComposeWorkspace: handleCloseComposeWorkspace,
    openComposeWorkspace: handleComposeDraftRequested,
  } = composeWorkspace;
  if (!isWorkspaceReady) {
    return <LoadingPage />;
  }

  return (
    <MailboxWorkspaceBody
      activeMailbox={activeMailbox}
      chatId={chatId ?? null}
      composeSessionKey={composeWorkspace.composeSessionKey}
      defaultMailboxId={defaultMailboxId}
      isComposeMailbox={isComposeMailbox}
      isConnectingGmail={isStartingGmailConnection}
      isDemoMode={isDemoMode}
      isManagedDemoMode={isManagedDemoMode}
      chats={chats}
      draftChatKey={draftChatKey}
      isTemplateMailbox={isTemplateMailbox}
      layoutState={{ isMobileSidebarOpen }}
      mailboxGroups={mailboxGroups}
      messageId={messageId}
      onCloseCompose={handleCloseComposeWorkspace}
      onConnectGmail={() => {
        void connectGmail();
      }}
      onComposeDraftRequested={handleComposeDraftRequested}
      onComposeNewMail={createComposeDraft}
      onManageTemplates={manageTemplates}
      onMobileOpenChange={setIsMobileSidebarOpen}
      onOpenSidebar={() => {
        setIsMobileSidebarOpen(true);
      }}
      onReorderMailboxSwitcher={(order) => {
        updateMailboxSwitcherOrderMutation.mutate(order);
      }}
      onSearch={applySearch}
      onCreateChat={createChat}
      onDeleteChat={(deletedChatId) => {
        void chatSidebarActions.deleteChat(deletedChatId);
      }}
      onRenameChat={(renamedChatId, title) => {
        void chatSidebarActions.renameChat(renamedChatId, title);
      }}
      onReconnectMailbox={(mailbox) => {
        void reconnectMailbox(mailbox);
      }}
      onSelectChat={selectChat}
      onSelectMailbox={selectMailbox}
      onSelectMailboxId={selectMailboxId}
      onSelectView={selectView}
      onChatIdChange={changeChatId}
      onSetDefaultMailbox={(nextMailboxId) => {
        void setDefaultMailboxMutation.mutateAsync({
          mailboxId: nextMailboxId,
        });
      }}
      query={query}
      reconnectError={gmailReconnectError}
      reconnectingMailboxId={reconnectingMailboxId}
      selectedMailbox={
        mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null
      }
      selectedMailboxId={selectedMailboxId}
      selectedMailboxProvider={selectedMailboxProvider}
      selectedMailboxNeedsReconnect={selectedMailboxNeedsReconnect}
      selectedView={view}
      threadId={threadId}
    />
  );
};
