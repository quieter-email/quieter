"use client";

import {
  Loading03Icon,
  Mail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { domAnimation, LazyMotion, m } from "motion/react";
import { lazy, Suspense, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { MobileHeader } from "#/components/mobile-header";
import {
  WorkspaceSection,
  workspaceSectionVariants,
} from "#/components/workspace-section";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import { MailSidebar } from "#/features/navigation/components/mail-sidebar";
import type { MailboxSwitcherOrder } from "#/features/navigation/components/mailbox-switcher";
import type { MailboxCategory } from "#/lib/gmail/gmail";

import { MailboxMessagesPanel } from "./mailbox-messages-panel";

const ChatView = lazy(
  async () =>
    await import("#/features/chat/components/chat-view").then(
      ({ ChatView: Component }) => ({
        default: Component,
      })
    )
);

const ComposeWorkspace = lazy(
  async () =>
    await import("#/features/compose/components/compose-workspace").then(
      ({ ComposeWorkspace: Component }) => ({
        default: Component,
      })
    )
);

const TemplateWorkspace = lazy(
  async () =>
    await import("#/features/compose/components/template-workspace").then(
      ({ TemplateWorkspace: Component }) => ({
        default: Component,
      })
    )
);

const FirstRunManagedMailSetup = lazy(
  async () =>
    await import("./first-run-managed-mail-setup").then(
      ({ FirstRunManagedMailSetup: Component }) => ({
        default: Component,
      })
    )
);

type MailboxSidebarGroups = ComponentProps<typeof MailSidebar>["groups"];
type MailboxSidebarChats = ComponentProps<typeof MailSidebar>["chats"];

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type MailboxWorkspaceLayoutState = {
  isMobileSidebarOpen: boolean;
};

type MailboxWorkspaceContentProps = {
  activeMailbox: MailboxCategory | null;
  chatContext?: {
    messageId?: string;
    query?: string;
    threadId?: string;
  };
  chatId: string | null;
  chats: MailboxSidebarChats;
  composeSessionKey: number;
  currentUserEmail: string | null;
  defaultMailboxId: string | null;
  draftChatKey: string;
  isComposeMailbox: boolean;
  isConnectingGmail: boolean;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  layoutState: MailboxWorkspaceLayoutState;
  mailboxGroups: MailboxSidebarGroups;
  onCloseCompose: () => void;
  onConnectGmail: () => void;
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onComposeNewMail: () => void;
  onManageTemplates: () => void;
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
  style: { transformOrigin: "center center" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

const ComposeWorkspaceLoading = ({
  onOpenSidebar,
}: Pick<MailboxWorkspaceContentProps, "onOpenSidebar">) => (
  <WorkspaceSection aria-busy="true" data-compose-workspace>
    <div className="flex h-full min-h-0 flex-col">
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
  </WorkspaceSection>
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
            <Suspense fallback={null}>
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
            </Suspense>
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
            {hasText(connectError) ? (
              <p className="mt-3 text-body text-destructive">{connectError}</p>
            ) : null}
          </m.div>
        )}
      </m.section>
    </LazyMotion>
  );
};

export const MailboxWorkspaceContent = ({
  activeMailbox,
  chatContext,
  chatId,
  chats,
  composeSessionKey,
  currentUserEmail,
  defaultMailboxId,
  draftChatKey,
  isComposeMailbox,
  isConnectingGmail,
  isDemoMode,
  isManagedDemoMode,
  layoutState,
  mailboxGroups,
  onCloseCompose,
  onConnectGmail,
  onComposeDraftRequested,
  onComposeNewMail,
  onManageTemplates,
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
  let mailboxContent: ReactNode;
  if (!hasText(selectedMailboxId)) {
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
          key={composeSessionKey}
          demoMode={isDemoMode}
          managedDemoMode={isManagedDemoMode}
          mailboxId={selectedMailboxId}
          onClose={onCloseCompose}
          onManageTemplates={onManageTemplates}
          onOpenSidebar={onOpenSidebar}
          persistDrafts={persistComposeDrafts}
          senderEmail={currentUserEmail}
          signature={signature}
        />
      </Suspense>
    );
  } else if (activeMailbox === null) {
    mailboxContent = (
      <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <Suspense fallback={null}>
          <TemplateWorkspace
            mailboxId={selectedMailboxId}
            onOpenSidebar={onOpenSidebar}
          />
        </Suspense>
      </div>
    );
  } else if (selectedMailboxNeedsReconnect) {
    const selectedMailbox = mailboxGroups
      .flatMap((group) => group.mailboxes)
      .find((mailbox) => mailbox.id === selectedMailboxId);
    const isReconnecting = reconnectingMailboxId === selectedMailboxId;
    mailboxContent = (
      <WorkspaceSection centered className="px-8">
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
            {hasText(reconnectError) ? (
              <p className="mt-3 text-body text-destructive">
                {reconnectError}
              </p>
            ) : null}
          </div>
        </m.div>
      </WorkspaceSection>
    );
  } else if (selectedView === "chat") {
    const mailboxOrganizationId =
      mailboxGroups.find((group) =>
        group.mailboxes.some((mailbox) => mailbox.id === selectedMailboxId)
      )?.id ?? "";
    mailboxContent = (
      <m.div
        key={`chat-${chatId ?? draftChatKey}`}
        className={workspaceSectionVariants()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.08, ease: "linear" }}
      >
        <Suspense fallback={null}>
          <ChatView
            activeMailbox={activeMailbox}
            mailContext={chatContext}
            chatId={chatId}
            draftChatKey={draftChatKey}
            mailboxId={selectedMailboxId}
            mailboxOrganizationId={mailboxOrganizationId}
            onChatIdChange={onChatIdChange}
            onOpenSidebar={onOpenSidebar}
          />
        </Suspense>
      </m.div>
    );
  } else {
    mailboxContent = (
      <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <MailboxMessagesPanel
          activeMailbox={activeMailbox}
          currentUserEmail={currentUserEmail}
          isDemoMode={isDemoMode}
          isManagedDemoMode={isManagedDemoMode}
          mailboxId={selectedMailboxId}
          mailboxProvider={selectedMailboxProvider ?? "gmail"}
          onComposeDraftRequested={onComposeDraftRequested}
          onOpenSidebar={onOpenSidebar}
          onSearchQueryChange={onSearch}
          searchQuery={searchQuery}
        />
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <main className="relative isolate flex h-dvh min-h-0 flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-fg lg:p-0">
        <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
          {hasText(selectedMailboxId) ? (
            <MailSidebar
              activeChatId={chatId}
              chats={chats}
              defaultMailboxId={defaultMailboxId}
              groups={mailboxGroups}
              onComposeNewMail={onComposeNewMail}
              onMobileOpenChange={onMobileOpenChange}
              onReorderMailboxSwitcher={onReorderMailboxSwitcher}
              onReconnectMailbox={onReconnectMailbox}
              onSearch={onSearch}
              onCreateChat={onCreateChat}
              onDeleteChat={onDeleteChat}
              onRenameChat={onRenameChat}
              onSelectChat={onSelectChat}
              onSelectMailbox={onSelectMailbox}
              onSelectMailboxId={onSelectMailboxId}
              onSelectView={onSelectView}
              onSetDefaultMailbox={onSetDefaultMailbox}
              reconnectingMailboxId={reconnectingMailboxId}
              searchQuery={searchQuery}
              selectedMailbox={activeMailbox}
              selectedMailboxId={selectedMailboxId}
              selectedMailboxProvider={selectedMailboxProvider}
              selectedView={selectedView}
              isMobileOpen={layoutState.isMobileSidebarOpen}
            />
          ) : null}

          <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
            {mailboxContent}
          </div>
        </div>
      </main>
    </LazyMotion>
  );
};
