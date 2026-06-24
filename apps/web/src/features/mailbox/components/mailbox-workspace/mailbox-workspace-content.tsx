"use client";

import { Loading03Icon, Mail01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton, cn } from "@quieter/ui";
import { domAnimation, LazyMotion, m } from "motion/react";
import { useState, type ComponentProps } from "react";
import type { ComposeDraftState } from "~/features/compose";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxSwitcherOrder } from "~/features/navigation/components/mailbox-switcher";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { ChatView } from "~/features/chat/components/chat-view";
import { MailSidebar } from "~/features/navigation/components/mail-sidebar";
import { FirstRunManagedMailSetup } from "./first-run-managed-mail-setup";
import { MailboxMessagesPanel } from "./mailbox-messages-panel";

type MailboxSidebarGroups = ComponentProps<typeof MailSidebar>["groups"];
type MailboxSidebarChats = ComponentProps<typeof MailSidebar>["chats"];

type MailboxWorkspaceLayoutState = {
  isMobileSidebarOpen: boolean;
};

type MailboxWorkspaceContentProps = {
  activeMailbox: MailboxCategory;
  chatId: string | null;
  chats: MailboxSidebarChats;
  currentUserEmail: string | null;
  defaultMailboxId: string | null;
  draftChatKey: string;
  isConnectingGmail: boolean;
  isDemoMode: boolean;
  layoutState: MailboxWorkspaceLayoutState;
  mailboxGroups: MailboxSidebarGroups;
  onConnectGmail: () => void;
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onComposeNewMail: () => void;
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
  reconnectError: string | null;
  reconnectingMailboxId: string | null;
  searchQuery: string;
  selectedMailboxId: string | null;
  selectedMailboxProvider: "gmail" | "managed" | null;
  selectedMailboxNeedsReconnect: boolean;
  selectedView: MailboxWorkspaceView;
};

const workspaceContentMotion = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  style: { transformOrigin: "center center" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

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
        initial={{ opacity: 0, scale: 0.96, filter: "blur(14px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.96, filter: "blur(14px)" }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="absolute inset-0 flex items-center justify-center overflow-y-auto px-6 py-8"
      >
        <LinkButton
          aria-label="Settings"
          className="group absolute bottom-5 left-5 justify-start"
          search={{ from: "/", tab: "general" }}
          to="/settings"
          variant="ghost"
        >
          <HugeiconsIcon
            className="size-4 shrink-0 rotate-0 transition-transform duration-1000 ease-in-out group-hover:rotate-360"
            icon={Settings01Icon}
            strokeWidth={1.5}
          />
          Settings
        </LinkButton>
        {setupMode === "managed" ? (
          <m.div className="w-full" {...workspaceContentMotion}>
            <FirstRunManagedMailSetup
              onBack={() => setSetupMode("choice")}
              organizations={mailboxGroups.map((group) => ({
                id: group.id,
                mailboxes: group.mailboxes.map((mailbox) => ({
                  provider: mailbox.provider as "gmail" | "managed",
                })),
                name: group.name,
              }))}
            />
          </m.div>
        ) : (
          <m.div className="w-full max-w-2xl text-center" {...workspaceContentMotion}>
            <HugeiconsIcon
              aria-hidden
              className="mx-auto size-5 text-muted-foreground"
              icon={Mail01Icon}
            />
            <h1 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
              Connect a mailbox
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Connect Gmail, or set up managed mail to send and receive from your own domain with
              managed mailboxes and API keys.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                className="rounded-lg border border-border/70 bg-background/80 p-4 text-left shadow-sm transition-colors hover:bg-secondary/35 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                disabled={isConnectingGmail}
                onClick={onConnectGmail}
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <HugeiconsIcon
                    aria-hidden
                    className={cn("size-4", { "animate-spin": isConnectingGmail })}
                    icon={isConnectingGmail ? Loading03Icon : Mail01Icon}
                  />
                  {isConnectingGmail ? "Opening Google" : "Connect Gmail"}
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  Add an existing Gmail or Google Workspace inbox.
                </span>
              </button>
              <button
                className="rounded-lg border border-border/70 bg-background/80 p-4 text-left shadow-sm transition-colors hover:bg-secondary/35 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                onClick={() => setSetupMode("managed")}
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <HugeiconsIcon aria-hidden className="size-4" icon={Mail01Icon} />
                  Set up managed mail
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  Use your own domain with managed mailboxes and API keys.
                </span>
              </button>
            </div>
            <div className="mt-4">
              <LinkButton search={{ from: "/", tab: "general" }} to="/settings" variant="ghost">
                Open settings
              </LinkButton>
            </div>
            {connectError && <p className="mt-3 text-sm text-destructive">{connectError}</p>}
          </m.div>
        )}
      </m.section>
    </LazyMotion>
  );
};

export const MailboxWorkspaceContent = ({
  activeMailbox,
  chatId,
  chats,
  currentUserEmail,
  defaultMailboxId,
  draftChatKey,
  isConnectingGmail,
  isDemoMode,
  layoutState,
  mailboxGroups,
  onConnectGmail,
  onComposeDraftRequested,
  onComposeNewMail,
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
  reconnectError,
  reconnectingMailboxId,
  searchQuery,
  selectedMailboxId,
  selectedMailboxProvider,
  selectedMailboxNeedsReconnect,
  selectedView,
}: MailboxWorkspaceContentProps) => (
  <LazyMotion features={domAnimation}>
    <main className="relative isolate flex h-dvh min-h-0 flex-col overflow-hidden bg-background-dark text-foreground">
      <WorkspaceDitherBackground />
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {selectedMailboxId && (
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
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
          {!selectedMailboxId ? (
            <NoMailboxWorkspace
              connectError={reconnectError}
              isConnectingGmail={isConnectingGmail}
              mailboxGroups={mailboxGroups}
              onConnectGmail={onConnectGmail}
            />
          ) : selectedView === "chat" ? (
            <m.div
              key={`chat-${chatId ?? draftChatKey}`}
              className="absolute inset-1.5 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.08, ease: "linear" }}
            >
              <ChatView
                activeMailbox={activeMailbox}
                chatId={chatId}
                draftChatKey={draftChatKey}
                mailboxId={selectedMailboxId}
                mailboxOrganizationId={
                  mailboxGroups.find((group) =>
                    group.mailboxes.some((mailbox) => mailbox.id === selectedMailboxId),
                  )?.id ?? ""
                }
                onChatIdChange={onChatIdChange}
                onOpenSidebar={onOpenSidebar}
              />
            </m.div>
          ) : (
            <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
              {selectedMailboxNeedsReconnect ? (
                <section className="flex min-h-0 flex-1 items-center justify-center bg-background px-8">
                  <m.div className="max-w-md space-y-3 text-center" {...workspaceContentMotion}>
                    <h1 className="text-lg font-semibold tracking-tight text-foreground">
                      Reconnect Google
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      This account needs to reconnect through Google before Quieter can load mail.
                    </p>
                    <div className="pt-1">
                      <Button
                        disabled={reconnectingMailboxId === selectedMailboxId}
                        onClick={() => {
                          const selectedMailbox = mailboxGroups
                            .flatMap((group) => group.mailboxes)
                            .find((m) => m.id === selectedMailboxId);
                          onReconnectMailbox({
                            emailAddress: selectedMailbox?.emailAddress ?? "",
                            id: selectedMailboxId ?? "",
                          });
                        }}
                        type="button"
                      >
                        <HugeiconsIcon
                          aria-hidden
                          className={cn("size-4", {
                            "animate-spin": reconnectingMailboxId === selectedMailboxId,
                          })}
                          icon={
                            reconnectingMailboxId === selectedMailboxId ? Loading03Icon : Mail01Icon
                          }
                        />
                        Reconnect
                      </Button>
                      {reconnectError && (
                        <p className="mt-3 text-sm text-destructive">{reconnectError}</p>
                      )}
                    </div>
                  </m.div>
                </section>
              ) : (
                <MailboxMessagesPanel
                  activeMailbox={activeMailbox}
                  currentUserEmail={currentUserEmail}
                  isDemoMode={isDemoMode}
                  mailboxId={selectedMailboxId}
                  mailboxProvider={selectedMailboxProvider!}
                  onComposeDraftRequested={onComposeDraftRequested}
                  onOpenSidebar={onOpenSidebar}
                  onSearchQueryChange={onSearch}
                  searchQuery={searchQuery}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  </LazyMotion>
);
