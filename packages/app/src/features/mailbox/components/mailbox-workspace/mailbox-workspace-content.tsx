"use client";

import {
  Loading03Icon,
  Mail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MobileHeader } from "@quieter/app/components/mobile-header";
import { AgentWorkspaceProvider } from "@quieter/app/features/chat/components/agent-workspace";
import { AssistantSidebar } from "@quieter/app/features/chat/components/assistant-sidebar";
import {
  AssistantSidebarContext,
  AssistantSidebarTrigger,
} from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import { DraftRecoveryNotice } from "@quieter/app/features/compose/components/draft-recovery-notice";
import { buildComposeDraftFromSavedDraftMessage } from "@quieter/app/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { FirstRunManagedMailSetup } from "@quieter/app/features/mailbox/components/mailbox-workspace/first-run-managed-mail-setup";
import { MailboxMessagesPanel } from "@quieter/app/features/mailbox/components/mailbox-workspace/mailbox-messages-panel";
import {
  useMailboxMessageId,
  useMailboxSearchActions,
  useMailboxRouteSearch,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import {
  loadChatView,
  loadComposeWorkspace,
  loadSnippetWorkspace,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/workspace-component-loaders";
import { UnifiedInboxPanel } from "@quieter/app/features/mailbox/components/unified-inbox-panel";
import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import { LabelsWorkspacePanel } from "@quieter/app/features/message-labels/components/labels-workspace-panel";
import { MailSidebar } from "@quieter/app/features/navigation/components/mail-sidebar";
import type { MailboxSwitcherOrder } from "@quieter/app/features/navigation/components/mailbox-switcher";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Text } from "@quieter/ui/text";
import {
  WorkspaceSection,
  workspaceGutterClassName,
  workspaceSectionVariants,
} from "@quieter/ui/workspace-section";
import { domAnimation, LazyMotion, m } from "motion/react";
import {
  Activity,
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";

const ChatView = lazy(loadChatView);

const CalendarWorkspace = lazy(async () => {
  const { CalendarWorkspace: Workspace } =
    await import("@quieter/app/features/calendar/components/calendar-workspace");
  return { default: Workspace };
});

const ComposeWorkspace = lazy(loadComposeWorkspace);

const SnippetWorkspace = lazy(loadSnippetWorkspace);

const messagePanelsClassName = cn(
  workspaceGutterClassName,
  "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,max(34%,405px))_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:pl-(--workspace-gutter)"
);

type MailboxSidebarGroups = ComponentProps<typeof MailSidebar>["groups"];
type MailboxSidebarChats = { id: string; title: string | null }[];

type MailboxWorkspaceLayoutState = {
  isMobileSidebarOpen: boolean;
};

type MailboxWorkspaceContentProps = {
  userId: string;
  activeMailbox: MailboxCategory | null;
  chatContext?: {
    messageId?: string;
    query?: string;
    threadId?: string;
  };
  chatId: string | null;
  chats: MailboxSidebarChats;
  composeSession: {
    key: number;
    draft: ComposeDraftState | null;
    mailboxId: string | null;
  };
  currentUserEmail: string | null;
  draftChatKey: string;
  isComposeMailbox: boolean;
  isSnippetMailbox: boolean;
  isConnectingGmail: boolean;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  layoutState: MailboxWorkspaceLayoutState;
  mailboxGroups: MailboxSidebarGroups;
  onCloseCompose: () => void;
  onComposeSenderSwitch: (mailboxId: string) => Promise<void>;
  onConnectGmail: () => void;
  onComposeDraftRequested: (
    draft: ComposeDraftState,
    mailboxId?: string
  ) => void;
  onComposeNewMail: () => void;
  onManageSnippets: () => void;
  onMobileOpenChange: (open: boolean) => void;
  onOpenSidebar: () => void;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onSearch: (query: string) => void;
  onCreateChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onReconnectMailbox: (mailbox: { emailAddress: string; id: string }) => void;
  onSelectChat: (chatId: string) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSelectView: (view: MailboxWorkspaceView) => void;
  onChatIdChange: (chatId: string) => void;
  persistComposeDrafts: boolean;
  reconnectError: string | null;
  reconnectingMailboxId: string | null;
  searchQuery: string;
  selectedMailboxId: string | null;
  selectedMailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailboxNeedsReconnect: boolean;
  selectedView: MailboxWorkspaceView;
  signature?: { html: string | null; text: string | null };
};

const workspaceContentMotion = {
  animate: { filter: "blur(0px)", opacity: 1, scale: 1 },
  exit: { filter: "blur(14px)", opacity: 0, scale: 0.96 },
  initial: { filter: "blur(14px)", opacity: 0, scale: 0.96 },
  // oxlint-disable-next-line shadcn/no-inline-styles -- Motion preset pivots around the center.
  style: { transformOrigin: "center center" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

const ComposeWorkspaceLoading = ({
  onOpenSidebar,
}: Pick<MailboxWorkspaceContentProps, "onOpenSidebar">) => (
  <div className="flex h-full min-h-0 flex-col" data-compose-workspace>
    <MobileHeader
      className="px-4 sm:px-6"
      leading="sidebar"
      onLeadingClick={onOpenSidebar}
      title="New message"
    />
    <output
      aria-label="Loading composer"
      aria-live="polite"
      className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 p-6 text-body text-muted-fg sm:p-8"
    >
      <HugeiconsIcon
        aria-hidden
        className="size-5 animate-spin"
        icon={Loading03Icon}
      />
      Loading composer…
    </output>
  </div>
);

const NoMailboxWorkspace = ({
  connectError,
  isConnectingGmail,
  mailboxGroups,
  onConnectGmail,
}: {
  connectError: string | null;
  isConnectingGmail: boolean;
  mailboxGroups: MailboxSidebarGroups;
  onConnectGmail: () => void;
}) => {
  const [setupMode, setSetupMode] = useState<"choice" | "managed">("choice");

  return (
    <LazyMotion features={domAnimation}>
      <m.section
        initial={{ filter: "blur(14px)", opacity: 0, scale: 0.96 }}
        animate={{ filter: "blur(0px)", opacity: 1, scale: 1 }}
        exit={{ filter: "blur(14px)", opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="absolute inset-0 flex items-center justify-center overflow-y-auto px-6 py-8"
      >
        <LinkButton
          aria-label="Settings"
          className="group absolute bottom-5 left-5 justify-start"
          search={{ from: "/" }}
          to="/settings"
          variant="ghost"
        >
          <HugeiconsIcon
            className="size-4 shrink-0"
            icon={Settings01Icon}
            strokeWidth={1.5}
          />
          Settings
        </LinkButton>
        {setupMode === "managed" ? (
          <m.div className="w-full" {...workspaceContentMotion}>
            <FirstRunManagedMailSetup
              onBack={() => {
                setSetupMode("choice");
              }}
              organizations={mailboxGroups.map((group) => ({
                id: group.id,
                mailboxes: group.mailboxes.flatMap((mailbox) =>
                  mailbox.provider === "api"
                    ? []
                    : [{ provider: mailbox.provider }]
                ),
                name: group.name,
              }))}
            />
          </m.div>
        ) : (
          <m.div
            className="w-full max-w-2xl text-center"
            {...workspaceContentMotion}
          >
            <HugeiconsIcon
              aria-hidden
              className="mx-auto size-5 text-muted-fg"
              icon={Mail01Icon}
            />
            <h1 className="mt-5 text-body-lg font-semibold tracking-tight text-fg">
              Connect a mailbox
            </h1>
            <p className="mx-auto mt-2 max-w-md text-body text-muted-fg">
              Connect Gmail, or set up managed mail to send and receive from
              your own domain with managed mailboxes and API keys.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button
                disabled={isConnectingGmail}
                onClick={onConnectGmail}
                type="button"
                variant="card"
              >
                <span className="flex items-center gap-2 text-body font-medium text-fg">
                  <HugeiconsIcon
                    aria-hidden
                    className={cn("size-4", {
                      "animate-spin": isConnectingGmail,
                    })}
                    icon={isConnectingGmail ? Loading03Icon : Mail01Icon}
                  />
                  {isConnectingGmail ? "Opening Google" : "Connect Gmail"}
                </span>
                <span className="mt-2 block text-body text-muted-fg">
                  Add an existing Gmail or Google Workspace inbox.
                </span>
              </Button>
              <Button
                onClick={() => {
                  setSetupMode("managed");
                }}
                type="button"
                variant="card"
              >
                <span className="flex items-center gap-2 text-body font-medium text-fg">
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Mail01Icon}
                  />
                  Set up managed mail
                </span>
                <span className="mt-2 block text-body text-muted-fg">
                  Use your own domain with managed mailboxes and API keys.
                </span>
              </Button>
            </div>
            <div className="mt-4">
              <LinkButton search={{ from: "/" }} to="/settings" variant="ghost">
                Open settings
              </LinkButton>
            </div>
            {connectError ? (
              <Text className="mt-3" tone="destructive">
                {connectError}
              </Text>
            ) : null}
          </m.div>
        )}
      </m.section>
    </LazyMotion>
  );
};

const MailboxWorkspaceContentInner = ({
  userId,
  activeMailbox,
  chatContext,
  chatId,
  chats,
  composeSession,
  currentUserEmail,
  draftChatKey,
  isComposeMailbox,
  isSnippetMailbox,
  isConnectingGmail,
  isDemoMode,
  isManagedDemoMode,
  layoutState,
  mailboxGroups,
  onCloseCompose,
  onComposeSenderSwitch,
  onConnectGmail,
  onComposeDraftRequested,
  onComposeNewMail,
  onManageSnippets,
  onMobileOpenChange,
  onOpenSidebar,
  onReorderMailboxSwitcher,
  onSearch,
  onCreateChat,
  onDeleteChat,
  onRenameChat,
  onReconnectMailbox,
  onSelectChat,
  onSelectMailbox,
  onSelectMailboxId,
  onSelectView,
  onChatIdChange,
  persistComposeDrafts,
  reconnectError,
  reconnectingMailboxId,
  searchQuery,
  selectedMailboxId,
  selectedMailboxProvider,
  selectedMailboxNeedsReconnect,
  selectedView,
  signature,
}: MailboxWorkspaceContentProps) => {
  const messageId = useMailboxMessageId() ?? null;
  const setMailboxSearch = useMailboxSearchActions();
  const { workspace } = useMailboxRouteSearch();
  const calendarActive = workspace === "calendar";
  const allInboxesActive = selectedView === "all-inboxes";
  const mailboxes = mailboxGroups.flatMap((group) => group.mailboxes);
  const senderMailboxes = mailboxes
    .filter(
      (mailbox) =>
        mailbox.provider !== "api" &&
        mailbox.connectionStatus === "connected" &&
        mailbox.grantRole !== "reader"
    )
    .map((mailbox) => ({
      ...mailbox,
      signatureHtml: mailbox.signatureHtml ?? null,
      signatureText: mailbox.signatureText ?? null,
    }));
  const composeMailbox = mailboxes.find(
    (mailbox) => mailbox.id === selectedMailboxId
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantOpened, setAssistantOpened] = useState(false);
  const [assistantFocusRequest, setAssistantFocusRequest] = useState(0);
  const [combinedFocusTarget, setCombinedFocusTarget] = useState<{
    mailboxId: string;
    messageId: string;
  } | null>(null);
  const pendingKeyboardOpenRef = useRef(false);
  const assistantPanelId = useId();
  const assistantTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [assistantNarrow, setAssistantNarrow] = useState(false);
  const assistantAutoCollapsedRef = useRef(false);
  const agentWorkspace = useAgentWorkspace();
  const restoreAssistantTriggerFocus = () => {
    window.requestAnimationFrame(() => {
      const trigger = assistantTriggerRef.current;
      if (
        trigger?.isConnected === true &&
        trigger.getClientRects().length > 0
      ) {
        trigger.focus();
        return;
      }
      const visibleTrigger = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "[data-assistant-launcher]"
        ),
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Open sidebar"]'
        ),
      ].find((button) => button.getClientRects().length > 0);
      visibleTrigger?.focus();
    });
  };
  useLayoutEffect(() => {
    let closed = false;
    try {
      closed =
        localStorage.getItem("quieter:assistant-sidebar-closed") === "true";
    } catch {
      // Use the default sidebar layout when storage is unavailable.
    }
    const wide = window.matchMedia("(min-width: 80rem)").matches;
    // oxlint-disable-next-line react/set-state-in-effect -- Load the chat only when the restored sidebar is visible.
    setAssistantOpened(wide && !closed);
    // oxlint-disable-next-line react/set-state-in-effect -- Restore the sidebar's initial visibility for the current viewport.
    setAssistantOpen(wide && !closed);
    assistantAutoCollapsedRef.current = !wide && !closed;
  }, []);
  const updateAssistantViewport = useEffectEvent((wide: boolean) => {
    setAssistantNarrow(!wide);
    if (!wide && assistantOpen) {
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest("[data-assistant-sidebar]") !== null
      ) {
        restoreAssistantTriggerFocus();
      }
      assistantAutoCollapsedRef.current = true;
      agentWorkspace?.control.cancel();
      setAssistantOpen(false);
    } else if (wide && assistantAutoCollapsedRef.current) {
      assistantAutoCollapsedRef.current = false;
      setAssistantOpened(true);
      setAssistantOpen(true);
    }
  });
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 80rem)");
    const update = () => {
      updateAssistantViewport(desktop.matches);
    };
    update();
    desktop.addEventListener("change", update);
    return () => {
      desktop.removeEventListener("change", update);
    };
  }, []);
  let mailboxContent: ReactNode;
  if (!selectedMailboxId) {
    mailboxContent = (
      <NoMailboxWorkspace
        connectError={reconnectError}
        isConnectingGmail={isConnectingGmail}
        mailboxGroups={mailboxGroups}
        onConnectGmail={onConnectGmail}
      />
    );
  } else if (isComposeMailbox) {
    mailboxContent = (
      <Suspense
        fallback={<ComposeWorkspaceLoading onOpenSidebar={onOpenSidebar} />}
      >
        <ComposeWorkspace
          key={composeSession.key}
          initialDraft={
            composeSession.mailboxId === selectedMailboxId
              ? composeSession.draft
              : null
          }
          demoMode={isDemoMode}
          managedDemoMode={isManagedDemoMode}
          mailboxId={composeMailbox?.id ?? null}
          onClose={onCloseCompose}
          onSwitchSenderMailbox={onComposeSenderSwitch}
          onManageSnippets={onManageSnippets}
          onOpenSidebar={onOpenSidebar}
          persistDrafts={persistComposeDrafts}
          senderEmail={composeMailbox?.emailAddress ?? currentUserEmail}
          senderMailbox={composeMailbox}
          senderMailboxes={allInboxesActive ? senderMailboxes : undefined}
          signature={
            composeMailbox
              ? {
                  html: composeMailbox.signatureHtml ?? null,
                  text: composeMailbox.signatureText ?? null,
                }
              : signature
          }
        />
      </Suspense>
    );
  } else if (activeMailbox === null) {
    mailboxContent = (
      <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
        <Suspense
          fallback={
            <WorkspaceSection centered className="lg:col-span-2">
              <output
                aria-label="Loading snippets"
                aria-live="polite"
                className="flex items-center gap-3 text-body text-muted-fg"
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-5 animate-spin"
                  icon={Loading03Icon}
                />
                Loading snippets…
              </output>
            </WorkspaceSection>
          }
        >
          <SnippetWorkspace
            key={selectedMailboxId}
            mailboxId={selectedMailboxId}
            onOpenSidebar={onOpenSidebar}
          />
        </Suspense>
      </div>
    );
  } else if (allInboxesActive) {
    mailboxContent = (
      <div className={messagePanelsClassName}>
        <WorkspaceSection
          className={cn({ flex: !messageId, hidden: !!messageId })}
          layout="cell"
        >
          <UnifiedInboxPanel
            activeMailbox={activeMailbox}
            activeMailboxId={selectedMailboxId}
            activeMessageId={messageId}
            activeThreadId={chatContext?.threadId ?? null}
            mailboxes={mailboxes}
            onOpenSidebar={onOpenSidebar}
            onReconnectMailbox={onReconnectMailbox}
            onSearch={onSearch}
            onDeactivateActiveMessage={() => {
              pendingKeyboardOpenRef.current = false;
              setCombinedFocusTarget(null);
              void setMailboxSearch({ messageId: null, threadId: null });
            }}
            onKeyboardOpenMessage={() => {
              pendingKeyboardOpenRef.current = true;
              queueMicrotask(() => {
                pendingKeyboardOpenRef.current = false;
              });
            }}
            onOpenDraft={(sourceMailboxId, message) => {
              onComposeDraftRequested(
                buildComposeDraftFromSavedDraftMessage(message),
                sourceMailboxId
              );
            }}
            onSelectMessage={(sourceMailboxId, nextMessageId, threadId) => {
              setCombinedFocusTarget(
                pendingKeyboardOpenRef.current
                  ? { mailboxId: sourceMailboxId, messageId: nextMessageId }
                  : null
              );
              pendingKeyboardOpenRef.current = false;
              void setMailboxSearch(
                {
                  chatId:
                    sourceMailboxId === selectedMailboxId ? undefined : null,
                  mailboxId: sourceMailboxId,
                  messageId: nextMessageId,
                  threadId,
                },
                {
                  replace:
                    !!messageId ||
                    !window.matchMedia("(max-width: 1023.98px)").matches,
                }
              );
            }}
            searchQuery={searchQuery}
            userId={userId}
          />
        </WorkspaceSection>
        {messageId ? (
          <MailboxMessagesPanel
            detailOnly
            activeMailbox={activeMailbox}
            senderMailbox={composeMailbox}
            currentUserEmail={currentUserEmail}
            focusOnOpen={
              combinedFocusTarget?.mailboxId === selectedMailboxId &&
              combinedFocusTarget.messageId === messageId
            }
            isDemoMode={isDemoMode}
            isManagedDemoMode={isManagedDemoMode}
            key={selectedMailboxId}
            mailboxId={selectedMailboxId}
            mailboxProvider={selectedMailboxProvider ?? "gmail"}
            onComposeDraftRequested={onComposeDraftRequested}
            onFocusRequestComplete={() => {
              setCombinedFocusTarget(null);
            }}
            onManageSnippets={onManageSnippets}
            onOpenSidebar={onOpenSidebar}
            onSearchQueryChange={onSearch}
            persistComposeDrafts={persistComposeDrafts}
            searchQuery={searchQuery}
            signature={signature}
          />
        ) : (
          <WorkspaceSection centered className="hidden" layout="cell">
            <HugeiconsIcon
              aria-hidden
              className="mb-3 size-5 text-muted-fg"
              icon={Mail01Icon}
            />
            <p className="text-body text-muted-fg">Select a conversation</p>
          </WorkspaceSection>
        )}
      </div>
    );
  } else if (selectedMailboxNeedsReconnect) {
    const selectedMailbox = mailboxGroups
      .flatMap((group) => group.mailboxes)
      .find((mailbox) => mailbox.id === selectedMailboxId);
    const isReconnecting = reconnectingMailboxId === selectedMailboxId;
    mailboxContent = (
      <WorkspaceSection>
        <MobileHeader
          leading="sidebar"
          onLeadingClick={onOpenSidebar}
          title="Mailbox"
        >
          <AssistantSidebarTrigger />
        </MobileHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center px-8">
          <m.div
            className="max-w-md space-y-3 text-center"
            {...workspaceContentMotion}
          >
            <h1 className="text-body-lg font-semibold tracking-tight text-fg">
              Reconnect Google
            </h1>
            <p className="text-body text-muted-fg">
              This account needs to reconnect through Google before Quieter can
              load mail.
            </p>
            <div className="pt-1">
              <Button
                disabled={isReconnecting}
                onClick={() => {
                  onReconnectMailbox({
                    emailAddress: selectedMailbox?.emailAddress ?? "",
                    id: selectedMailboxId,
                  });
                }}
                type="button"
              >
                <HugeiconsIcon
                  aria-hidden
                  className={cn("size-4", {
                    "animate-spin": isReconnecting,
                  })}
                  icon={isReconnecting ? Loading03Icon : Mail01Icon}
                />
                Reconnect
              </Button>
              {reconnectError ? (
                <Text className="mt-3" tone="destructive">
                  {reconnectError}
                </Text>
              ) : null}
            </div>
          </m.div>
        </div>
      </WorkspaceSection>
    );
  } else if (selectedView === "labels") {
    mailboxContent = (
      <m.div
        key="labels-panel"
        className={workspaceSectionVariants()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.08, ease: "linear" }}
      >
        <MobileHeader
          leading="sidebar"
          onLeadingClick={onOpenSidebar}
          title="Labels"
        >
          <AssistantSidebarTrigger />
        </MobileHeader>
        <LabelsWorkspacePanel
          canManage={
            selectedMailboxProvider !== "managed" ||
            composeMailbox?.grantRole === "manager"
          }
          key={selectedMailboxId}
          mailboxId={selectedMailboxId}
          mailboxProvider={
            selectedMailboxProvider === "managed" ? "managed" : "gmail"
          }
        />
      </m.div>
    );
  } else {
    mailboxContent = (
      <div className={messagePanelsClassName}>
        <MailboxMessagesPanel
          activeMailbox={activeMailbox}
          senderMailbox={composeMailbox}
          currentUserEmail={currentUserEmail}
          isDemoMode={isDemoMode}
          isManagedDemoMode={isManagedDemoMode}
          mailboxId={selectedMailboxId}
          mailboxProvider={selectedMailboxProvider ?? "gmail"}
          onComposeDraftRequested={onComposeDraftRequested}
          onManageSnippets={onManageSnippets}
          onOpenSidebar={onOpenSidebar}
          onSearchQueryChange={onSearch}
          persistComposeDrafts={persistComposeDrafts}
          searchQuery={searchQuery}
          signature={signature}
        />
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <AssistantSidebarContext
        value={
          selectedMailboxId && selectedMailboxProvider !== "api"
            ? {
                onOpen: (trigger) => {
                  assistantTriggerRef.current = trigger;
                  assistantAutoCollapsedRef.current = false;
                  setAssistantFocusRequest((request) => request + 1);
                  setAssistantOpened(true);
                  setAssistantOpen(true);
                  try {
                    localStorage.setItem(
                      "quieter:assistant-sidebar-closed",
                      "false"
                    );
                  } catch {
                    // Opening remains available without persistent storage.
                  }
                },
                open: assistantOpen,
                panelId: assistantPanelId,
                showNavigationTrigger:
                  calendarActive ||
                  isComposeMailbox ||
                  isSnippetMailbox ||
                  selectedView === "labels" ||
                  selectedMailboxNeedsReconnect,
              }
            : null
        }
      >
        <main className="pt-safe pr-safe pb-safe pl-safe relative isolate flex h-dvh min-h-0 flex-col overflow-hidden text-fg lg:p-0">
          <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
            <Activity mode={calendarActive ? "hidden" : "visible"}>
              {selectedMailboxId ? (
                <MailSidebar
                  userId={userId}
                  allInboxesActive={allInboxesActive}
                  groups={mailboxGroups}
                  onComposeNewMail={onComposeNewMail}
                  onOpenCalendar={() => {
                    onMobileOpenChange(false);
                    void setMailboxSearch(
                      { workspace: "calendar" },
                      { replace: false }
                    );
                  }}
                  onMobileOpenChange={onMobileOpenChange}
                  onReorderMailboxSwitcher={onReorderMailboxSwitcher}
                  onReconnectMailbox={onReconnectMailbox}
                  onSearch={onSearch}
                  onManageLabels={(sourceMailboxId) => {
                    if (sourceMailboxId) {
                      void setMailboxSearch({
                        chatId:
                          sourceMailboxId === selectedMailboxId
                            ? undefined
                            : null,
                        mailboxId: sourceMailboxId,
                        messageId: null,
                        query: null,
                        threadId: null,
                        view: "labels",
                      });
                    } else {
                      onSelectView("labels");
                    }
                  }}
                  onManageSnippets={onManageSnippets}
                  onSelectMailbox={onSelectMailbox}
                  onSelectMailboxId={onSelectMailboxId}
                  onSelectView={onSelectView}
                  reconnectingMailboxId={reconnectingMailboxId}
                  searchQuery={searchQuery}
                  selectedMailbox={activeMailbox}
                  isSnippetMailbox={isSnippetMailbox}
                  selectedMailboxId={selectedMailboxId}
                  selectedMailboxProvider={selectedMailboxProvider}
                  isMobileOpen={layoutState.isMobileSidebarOpen}
                />
              ) : null}
            </Activity>

            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div
                aria-hidden={
                  assistantOpen &&
                  assistantNarrow &&
                  selectedMailboxProvider !== "api"
                }
                inert={
                  assistantOpen &&
                  assistantNarrow &&
                  selectedMailboxProvider !== "api"
                }
                className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
              >
                <Activity mode={calendarActive ? "visible" : "hidden"}>
                  <Suspense
                    fallback={
                      <p className="p-6 text-body-sm text-muted-fg">
                        Loading calendar…
                      </p>
                    }
                  >
                    <CalendarWorkspace
                      isMobileSidebarOpen={layoutState.isMobileSidebarOpen}
                      onMobileSidebarOpenChange={onMobileOpenChange}
                      onBackToMail={() => {
                        onMobileOpenChange(false);
                        void setMailboxSearch(
                          { workspace: null },
                          { replace: false }
                        );
                      }}
                      userId={userId}
                    />
                  </Suspense>
                </Activity>
                <Activity mode={calendarActive ? "hidden" : "visible"}>
                  <div className="relative min-h-0 flex-1">
                    {mailboxContent}
                  </div>
                  {!allInboxesActive &&
                  !isComposeMailbox &&
                  !isDemoMode &&
                  !isManagedDemoMode &&
                  selectedMailboxId !== null ? (
                    <DraftRecoveryNotice
                      mailboxId={selectedMailboxId}
                      onResume={onComposeDraftRequested}
                    />
                  ) : null}
                </Activity>
              </div>
              {selectedMailboxId && selectedMailboxProvider !== "api" ? (
                <AssistantSidebar
                  id={assistantPanelId}
                  focusRequest={assistantFocusRequest}
                  open={assistantOpen}
                  activeChatId={chatId}
                  chats={chats.map((chat) => ({
                    ...chat,
                    title: chat.title ?? "New chat",
                  }))}
                  onChatSelect={(id) => {
                    agentWorkspace?.control.cancel();
                    onSelectChat(id);
                  }}
                  onNewChat={() => {
                    agentWorkspace?.control.cancel();
                    onCreateChat();
                  }}
                  onDeleteChat={(deletedChatId) => {
                    agentWorkspace?.control.cancel();
                    onDeleteChat(deletedChatId);
                  }}
                  onRenameChat={onRenameChat}
                  onMinimize={() => {
                    assistantAutoCollapsedRef.current = false;
                    agentWorkspace?.control.cancel();
                    setAssistantOpen(false);
                    try {
                      localStorage.setItem(
                        "quieter:assistant-sidebar-closed",
                        "true"
                      );
                    } catch {
                      // Closing remains available without persistent storage.
                    }
                    restoreAssistantTriggerFocus();
                  }}
                >
                  {assistantOpened ? (
                    <Suspense
                      fallback={
                        <p
                          className="p-4 text-body-sm text-muted-fg"
                          data-assistant-loading
                        >
                          Loading assistant…
                        </p>
                      }
                    >
                      {allInboxesActive && (
                        <p className="border-b border-border px-4 py-2 text-caption text-muted-fg">
                          Assistant for{" "}
                          {mailboxes
                            .find((mailbox) => mailbox.id === selectedMailboxId)
                            ?.displayName?.trim() || currentUserEmail}
                        </p>
                      )}
                      <ChatView
                        docked
                        visible={assistantOpen}
                        activeMailbox={activeMailbox ?? "inbox"}
                        mailContext={chatContext}
                        chatId={chatId}
                        draftChatKey={draftChatKey}
                        mailboxId={selectedMailboxId}
                        mailboxOrganizationId={
                          mailboxGroups.find((group) =>
                            group.mailboxes.some(
                              (mailbox) => mailbox.id === selectedMailboxId
                            )
                          )?.id ?? ""
                        }
                        onChatIdChange={onChatIdChange}
                      />
                    </Suspense>
                  ) : null}
                </AssistantSidebar>
              ) : null}
            </div>
          </div>
        </main>
      </AssistantSidebarContext>
    </LazyMotion>
  );
};

export const MailboxWorkspaceContent = (
  props: MailboxWorkspaceContentProps
) => (
  <AgentWorkspaceProvider
    key={
      props.selectedView === "all-inboxes"
        ? `all-inboxes:${props.userId}`
        : (props.selectedMailboxId ?? "empty")
    }
    mailboxId={props.selectedMailboxId ?? ""}
    onComposeDraftRequested={props.onComposeDraftRequested}
  >
    <MailboxWorkspaceContentInner {...props} />
  </AgentWorkspaceProvider>
);
