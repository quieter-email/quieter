"use client";

import {
  Loading03Icon,
  Mail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Text } from "@quieter/ui/text";
import {
  WorkspaceSection,
  workspaceSectionVariants,
} from "@quieter/ui/workspace-section";
import { domAnimation, LazyMotion, m } from "motion/react";
import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";

import { MobileHeader } from "#/components/mobile-header";
import { AgentWorkspaceProvider } from "#/features/chat/components/agent-workspace";
import { FloatingAssistant } from "#/features/chat/components/floating-assistant";
import { useAgentWorkspace } from "#/features/chat/domain/workspace-context";
import { DraftRecoveryNotice } from "#/features/compose/components/draft-recovery-notice";
import { buildComposeDraftFromSavedDraftMessage } from "#/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import { LabelsWorkspacePanel } from "#/features/message-labels/components/labels-workspace-panel";
import { MailSidebar } from "#/features/navigation/components/mail-sidebar";
import type { MailboxSwitcherOrder } from "#/features/navigation/components/mailbox-switcher";
import type { MailboxCategory } from "#/lib/mail";

import { UnifiedInboxPanel } from "../unified-inbox-panel";
import { useBriefMailboxActivity } from "../use-brief-mailbox-activity";
import { FirstRunManagedMailSetup } from "./first-run-managed-mail-setup";
import { MailboxMessagesPanel } from "./mailbox-messages-panel";
import {
  useMailboxMessageId,
  useMailboxSearchActions,
} from "./use-mailbox-route-search";
import {
  loadChatView,
  loadComposeWorkspace,
  loadSnippetWorkspace,
} from "./workspace-component-loaders";

const ChatView = lazy(loadChatView);

const ComposeWorkspace = lazy(loadComposeWorkspace);

const SnippetWorkspace = lazy(loadSnippetWorkspace);

const DailyBriefPanel = lazy(async () => {
  const { DailyBriefPanel: Panel } =
    await import("#/features/daily-brief/components/daily-brief-panel");
  return { default: Panel };
});

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
  defaultMailboxId: string | null;
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
  onSetDefaultMailbox: (mailboxId: string | null) => void;
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
              <button
                className="rounded-lg border border-border bg-bg-raised/80 p-4 text-left shadow-sm transition-colors hover:bg-muted/60"
                disabled={isConnectingGmail}
                onClick={onConnectGmail}
                type="button"
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
              </button>
              <button
                className="rounded-lg border border-border bg-bg-raised/80 p-4 text-left shadow-sm transition-colors hover:bg-muted/60"
                onClick={() => {
                  setSetupMode("managed");
                }}
                type="button"
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
              </button>
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
  defaultMailboxId,
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
  onSetDefaultMailbox,
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
  const allInboxesActive =
    selectedView === "all-inboxes" || selectedView === "all-inboxes-brief";
  const briefActive =
    selectedView === "daily-brief" || selectedView === "all-inboxes-brief";
  useBriefMailboxActivity(
    selectedMailboxId === null ? [] : [{ mailboxId: selectedMailboxId }],
    !isDemoMode &&
      !isManagedDemoMode &&
      !isComposeMailbox &&
      !isSnippetMailbox &&
      !briefActive &&
      !selectedMailboxNeedsReconnect &&
      selectedMailboxProvider !== "api" &&
      (!allInboxesActive || messageId !== null)
  );
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
  const [assistantSidebar, setAssistantSidebar] = useState(false);
  const [assistantNarrow, setAssistantNarrow] = useState(false);
  const assistantAutoCollapsedRef = useRef(false);
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem("quieter:assistant-mode") === "sidebar") {
        const closed =
          localStorage.getItem("quieter:assistant-sidebar-closed") === "true";
        const wide = window.matchMedia("(min-width: 80rem)").matches;
        // oxlint-disable-next-line react/set-state-in-effect -- Restore the optional browser preference before paint.
        setAssistantSidebar(true);
        // oxlint-disable-next-line react/set-state-in-effect -- Keep the existing chat mounted when restoring sidebar mode.
        setAssistantOpened(true);
        // oxlint-disable-next-line react/set-state-in-effect -- Restore the sidebar's initial visibility for the current viewport.
        setAssistantOpen(wide && !closed);
        assistantAutoCollapsedRef.current = !wide && !closed;
      }
    } catch {
      // Floating mode remains available when storage is disabled.
    }
  }, []);
  const updateAssistantViewport = useEffectEvent((wide: boolean) => {
    setAssistantNarrow(!wide);
    if (assistantSidebar) {
      if (!wide && assistantOpen) {
        assistantAutoCollapsedRef.current = true;
        setAssistantOpen(false);
      } else if (wide && assistantAutoCollapsedRef.current) {
        assistantAutoCollapsedRef.current = false;
        setAssistantOpen(true);
      }
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
  }, [assistantSidebar]);
  const agentWorkspace = useAgentWorkspace();
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
  } else if (briefActive) {
    mailboxContent = (
      <Suspense
        fallback={
          <WorkspaceSection>
            <p className="p-6 text-body text-muted-fg">Loading Brief…</p>
          </WorkspaceSection>
        }
      >
        <DailyBriefPanel
          key={allInboxesActive ? "all-inboxes-brief" : selectedMailboxId}
          combined={allInboxesActive}
          mailboxes={
            allInboxesActive
              ? mailboxes
              : mailboxes.filter((mailbox) => mailbox.id === selectedMailboxId)
          }
          onOpenSidebar={onOpenSidebar}
          onComposeDraftRequested={onComposeDraftRequested}
          onOpenSource={(sourceMailboxId, sourceMessageId, sourceThreadId) => {
            void setMailboxSearch({
              chatId: null,
              mailbox: "inbox",
              mailboxId: sourceMailboxId,
              messageId: sourceMessageId,
              query: null,
              threadId: sourceThreadId,
              view: "inbox",
            });
          }}
        />
      </Suspense>
    );
  } else if (allInboxesActive) {
    mailboxContent = (
      <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,max(34%,405px))_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:pl-2">
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
      <WorkspaceSection
        centered
        // oxlint-disable-next-line shadcn/no-restyle -- Preserve the existing empty-state content inset.
        className="px-8"
      >
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
        <LabelsWorkspacePanel
          mailboxId={selectedMailboxId}
          mailboxProvider={
            selectedMailboxProvider === "managed" ? "managed" : "gmail"
          }
        />
      </m.div>
    );
  } else {
    mailboxContent = (
      <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,max(34%,405px))_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:pl-2">
        <MailboxMessagesPanel
          activeMailbox={activeMailbox}
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
      <main className="pt-safe pr-safe pb-safe pl-safe relative isolate flex h-dvh min-h-0 flex-col overflow-hidden text-fg lg:p-0">
        <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
          {selectedMailboxId ? (
            <MailSidebar
              userId={userId}
              allInboxesActive={allInboxesActive}
              dailyBriefActive={briefActive}
              defaultMailboxId={defaultMailboxId}
              groups={mailboxGroups}
              onComposeNewMail={onComposeNewMail}
              onMobileOpenChange={onMobileOpenChange}
              onReorderMailboxSwitcher={onReorderMailboxSwitcher}
              onReconnectMailbox={onReconnectMailbox}
              onSearch={onSearch}
              onManageLabels={(sourceMailboxId) => {
                if (sourceMailboxId) {
                  void setMailboxSearch({
                    chatId:
                      sourceMailboxId === selectedMailboxId ? undefined : null,
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
              onSetDefaultMailbox={onSetDefaultMailbox}
              reconnectingMailboxId={reconnectingMailboxId}
              searchQuery={searchQuery}
              selectedMailbox={briefActive ? null : activeMailbox}
              isSnippetMailbox={isSnippetMailbox}
              selectedMailboxId={selectedMailboxId}
              selectedMailboxProvider={selectedMailboxProvider}
              isMobileOpen={layoutState.isMobileSidebarOpen}
            />
          ) : null}

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
            <div className="relative min-h-0 flex-1">{mailboxContent}</div>
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
          </div>
          {selectedMailboxId && selectedMailboxProvider !== "api" ? (
            <FloatingAssistant
              sidebar={assistantSidebar}
              narrow={assistantNarrow}
              focusRequest={assistantFocusRequest}
              onToggleSidebar={() => {
                const next = !assistantSidebar;
                assistantAutoCollapsedRef.current = next && assistantNarrow;
                setAssistantSidebar(next);
                setAssistantOpened(true);
                setAssistantFocusRequest((request) => request + 1);
                setAssistantOpen(!next || !assistantNarrow);
                try {
                  localStorage.setItem(
                    "quieter:assistant-mode",
                    next ? "sidebar" : "floating"
                  );
                  localStorage.setItem(
                    "quieter:assistant-sidebar-closed",
                    "false"
                  );
                } catch {
                  // Switching modes remains available without persistent storage.
                }
              }}
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
                if (assistantSidebar) {
                  try {
                    localStorage.setItem(
                      "quieter:assistant-sidebar-closed",
                      "true"
                    );
                  } catch {
                    // Closing remains available without persistent storage.
                  }
                }
              }}
              onOpen={() => {
                setAssistantFocusRequest((request) => request + 1);
                setAssistantOpened(true);
                setAssistantOpen(true);
                if (assistantSidebar) {
                  try {
                    localStorage.setItem(
                      "quieter:assistant-sidebar-closed",
                      "false"
                    );
                  } catch {
                    // Opening remains available without persistent storage.
                  }
                }
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
            </FloatingAssistant>
          ) : null}
        </div>
      </main>
    </LazyMotion>
  );
};

export const MailboxWorkspaceContent = (
  props: MailboxWorkspaceContentProps
) => (
  <AgentWorkspaceProvider
    key={
      props.selectedView === "all-inboxes" ||
      props.selectedView === "all-inboxes-brief"
        ? `all-inboxes:${props.userId}`
        : (props.selectedMailboxId ?? "empty")
    }
    mailboxId={props.selectedMailboxId ?? ""}
    onComposeDraftRequested={props.onComposeDraftRequested}
  >
    <MailboxWorkspaceContentInner {...props} />
  </AgentWorkspaceProvider>
);
