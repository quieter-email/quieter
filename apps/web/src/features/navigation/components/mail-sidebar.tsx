"use client";

import { useHeadlessConsentUI } from "@c15t/react";
import {
  Cancel01Icon,
  ChatAddIcon,
  Delete01Icon,
  Edit01Icon,
  HelpCircleIcon,
  MoreVerticalIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SubmitEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import { loadComposeWorkspace } from "#/features/mailbox/components/mailbox-workspace/workspace-component-loaders";
import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import { MailboxOrganizer } from "#/features/navigation/components/mailbox-organizer";
import { MailboxSwitcherDropdown } from "#/features/navigation/components/mailbox-switcher";
import type { MailboxSwitcherOrder } from "#/features/navigation/components/mailbox-switcher";
import { SidebarLabelNav } from "#/features/navigation/components/sidebar-label-nav";
import { SidebarMailboxNav } from "#/features/navigation/components/sidebar-mailbox-nav";
import { SidebarNavItem } from "#/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "#/features/navigation/components/sidebar-surfaces";
import { SidebarWorkspaceViewSwitch } from "#/features/navigation/components/sidebar-workspace-view-switch";
import type { MailboxCategory } from "#/lib/mail";

type MailSidebarProps = {
  activeChatId: string | null;
  chats: {
    id: string;
    title: string | null;
    updatedAt: Date;
  }[];
  defaultMailboxId: string | null;
  embedded?: boolean;
  groups: {
    id: string;
    kind: "division" | "organization" | "unassigned";
    mailboxes: {
      connectionStatus: "connected" | "needs_reconnect";
      divisionName?: string | null;
      grantRole?: "manager" | "reader" | "responder" | null;
      id: string;
      emailAddress: string;
      displayName: string | null;
      groupName: string;
      provider: "api" | "gmail" | "managed";
      unreadNonSpamCount: number;
    }[];
    name: string;
  }[];
  selectedMailboxId: string | null;
  selectedMailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory | null;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (mailbox: { emailAddress: string; id: string }) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onSearch: (query: string) => void;
  onCreateChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onSelectChat: (chatId: string) => void;
  onComposeNewMail: () => void;
  onManageLabels: () => void;
  onSelectView: (view: MailboxWorkspaceView) => void;
  reconnectingMailboxId: string | null;
  searchQuery: string;
  selectedView: MailboxWorkspaceView;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

type SidebarContentProps = Omit<
  MailSidebarProps,
  "isMobileOpen" | "onMobileOpenChange"
> & {
  animateEntrance: boolean;
  onRequestClose?: () => void;
  switcherSide?: "bottom" | "right";
};

let hasPlayedSidebarEntrance = false;

type SidebarChat = MailSidebarProps["chats"][number];

type SidebarChatRowProps = {
  animateEntrance: boolean;
  chat: SidebarChat;
  editingTitle: string;
  index: number;
  isActive: boolean;
  isEditing: boolean;
  onCancelRename: () => void;
  onDelete: (chatId: string) => void;
  onEditingTitleChange: (title: string) => void;
  onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onRenameSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onSelect: (chatId: string) => void;
  onStartRename: (chat: SidebarChat) => void;
};

const SidebarHelpMenu = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const { openDialog } = useHeadlessConsentUI();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
      <div className="squircle relative rounded-md hover:bg-muted/60 dark:hover:bg-muted/40">
        <IconButtonTooltip label="Help and legal">
          <DropdownMenuTrigger
            aria-label="Help and legal"
            className="relative z-10 inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-fg hover:bg-transparent hover:text-fg focus-visible:bg-transparent focus-visible:text-fg data-popup-open:bg-transparent data-popup-open:text-fg"
          >
            <HugeiconsIcon
              aria-hidden
              className="size-4"
              icon={HelpCircleIcon}
              strokeWidth={1.5}
            />
          </DropdownMenuTrigger>
        </IconButtonTooltip>
      </div>
      <DropdownMenuContent align="end" side="top" size="compact">
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/privacy" />}
        >
          Privacy
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/cookies" />}
        >
          Cookies
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/terms" />}
        >
          Terms
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/imprint" />}
        >
          Imprint
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onRequestClose?.();
            openDialog();
          }}
        >
          Privacy preferences
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <a href="https://logo.dev" rel="noreferrer" target="_blank">
              Logos by logo.dev
            </a>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const SidebarChatRow = ({
  animateEntrance,
  chat,
  editingTitle,
  index,
  isActive,
  isEditing,
  onCancelRename,
  onDelete,
  onEditingTitleChange,
  onRenameKeyDown,
  onRenameSubmit,
  onSelect,
  onStartRename,
}: SidebarChatRowProps) => {
  const titleValue = chat.title?.trim() ?? "";
  const title = titleValue.length > 0 ? titleValue : "New chat";

  return (
    <SidebarEntrance
      key={chat.id}
      animateEntrance={animateEntrance}
      className="w-full"
      index={index + 3}
    >
      {isEditing ? (
        <form className="w-full" onSubmit={onRenameSubmit}>
          <Input
            aria-label="Rename chat"
            className="h-8"
            onBlur={onCancelRename}
            onChange={(event) => {
              onEditingTitleChange(event.target.value);
            }}
            onKeyDown={onRenameKeyDown}
            size="sm"
            value={editingTitle}
          />
        </form>
      ) : (
        <SidebarNavItem
          active={isActive}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "h-8 min-w-0 flex-1 justify-start gap-3 rounded-md px-3 text-left transition-[color,transform] duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out) active:scale-[0.985] motion-reduce:active:scale-100",
            {
              "text-fg": isActive,
              "text-muted-fg": !isActive,
            }
          )}
          onClick={() => {
            onSelect(chat.id);
          }}
          size="sm"
          trailing={
            <DropdownMenu>
              <IconButtonTooltip label={`Options for "${title}"`}>
                <DropdownMenuTrigger
                  aria-label={`Options for "${title}"`}
                  className="squircle pointer-events-none relative z-20 mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-fg opacity-0 transition-[opacity,background-color,color,transform] duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out) group-hover:pointer-events-auto group-hover:bg-transparent group-hover:opacity-100 hover:bg-control-active hover:text-fg focus-visible:pointer-events-auto focus-visible:bg-control-active focus-visible:text-fg focus-visible:opacity-100 active:scale-95 data-popup-open:pointer-events-auto data-popup-open:bg-control-active data-popup-open:text-fg data-popup-open:opacity-100"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className="size-3.5"
                    icon={MoreVerticalIcon}
                  />
                </DropdownMenuTrigger>
              </IconButtonTooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    onStartRename(chat);
                  }}
                >
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Edit01Icon}
                  />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => {
                    onDelete(chat.id);
                  }}
                >
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Delete01Icon}
                  />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
          type="button"
          variant="ghost"
        >
          <span className="truncate">{title}</span>
        </SidebarNavItem>
      )}
    </SidebarEntrance>
  );
};

const SidebarInboxSection = ({
  animateEntrance,
  embedded,
  groups,
  onComposeNewMail,
  onManageLabels,
  onRequestClose,
  onSearch,
  onSelectMailbox,
  searchQuery,
  selectedMailbox,
  selectedMailboxId,
  selectedMailboxProvider,
}: Pick<
  SidebarContentProps,
  | "animateEntrance"
  | "embedded"
  | "groups"
  | "onComposeNewMail"
  | "onManageLabels"
  | "onRequestClose"
  | "onSearch"
  | "onSelectMailbox"
  | "searchQuery"
  | "selectedMailbox"
  | "selectedMailboxId"
  | "selectedMailboxProvider"
>) => {
  const selectedMailboxGrantRole = groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === selectedMailboxId)?.grantRole;
  const handleComposeNewMail = () => {
    onComposeNewMail();
    onRequestClose?.();
  };
  const handleSelectMailbox = (mailbox: MailboxCategory) => {
    onSelectMailbox(mailbox);
    onRequestClose?.();
  };
  return (
    <>
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="mt-3 p-1"
        index={2}
      >
        <Button
          aria-disabled={embedded === true || selectedMailboxProvider === "api"}
          className="w-full justify-start rounded-md px-4"
          disabled={
            !selectedMailboxId ||
            embedded === true ||
            selectedMailboxProvider === "api"
          }
          onClick={handleComposeNewMail}
          onFocus={() => void loadComposeWorkspace()}
          onMouseEnter={() => void loadComposeWorkspace()}
          onPointerDown={() => void loadComposeWorkspace()}
          type="button"
        >
          <HugeiconsIcon
            className="size-4 shrink-0"
            icon={Edit01Icon}
            strokeWidth={1.5}
          />
          Compose
        </Button>
      </SidebarEntrance>

      <div className="mt-2 min-h-0 flex-1 p-1">
        <SidebarMailboxNav
          animateEntrance={animateEntrance}
          mailboxProvider={selectedMailboxProvider}
          onSelectMailbox={handleSelectMailbox}
          selectedMailbox={selectedMailbox}
        />
        {selectedMailboxProvider === "managed" && selectedMailboxId ? (
          <MailboxOrganizer
            canManage={selectedMailboxGrantRole === "manager"}
            mailboxId={selectedMailboxId}
            searchQuery={searchQuery}
          />
        ) : null}
        {selectedMailboxProvider !== "api" && (
          <SidebarLabelNav
            animateEntrance={animateEntrance}
            canManage={
              embedded !== true &&
              (selectedMailboxProvider === "gmail" ||
                selectedMailboxGrantRole === "manager")
            }
            mailboxId={selectedMailboxId}
            mailboxProvider={selectedMailboxProvider ?? "gmail"}
            onManageLabels={onManageLabels}
            onSearch={(query) => {
              onSearch(query);
              onRequestClose?.();
            }}
            searchQuery={searchQuery}
          />
        )}
      </div>
    </>
  );
};

const SidebarChatSection = ({
  activeChatId,
  animateEntrance,
  chats,
  onCreateChat,
  onDeleteChat,
  onRenameChat,
  onRequestClose,
  onSelectChat,
}: Pick<
  SidebarContentProps,
  | "activeChatId"
  | "animateEntrance"
  | "chats"
  | "onCreateChat"
  | "onDeleteChat"
  | "onRenameChat"
  | "onRequestClose"
  | "onSelectChat"
>) => {
  const [editingChat, setEditingChat] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId);
    onRequestClose?.();
  };
  const startRenameChat = (chat: SidebarChat) => {
    const title = chat.title?.trim() ?? "";
    setEditingChat({
      id: chat.id,
      title: title.length > 0 ? title : "New chat",
    });
  };
  const submitRenameChat = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = editingChat?.title.trim();
    if (editingChat === null || !title) {
      setEditingChat(null);
      return;
    }
    onRenameChat(editingChat.id, title);
    setEditingChat(null);
  };
  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditingChat(null);
    }
  };

  return (
    <>
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="mt-3 p-1"
        index={2}
      >
        <Button
          className="w-full justify-start rounded-md px-4"
          onClick={() => {
            onCreateChat();
            onRequestClose?.();
          }}
          type="button"
        >
          <HugeiconsIcon
            className="size-4 shrink-0"
            icon={ChatAddIcon}
            strokeWidth={1.5}
          />
          New chat
        </Button>
      </SidebarEntrance>

      <nav
        aria-label="Chats"
        className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1"
      >
        {chats.map((chat, index) => {
          const isActive = chat.id === activeChatId;
          return (
            <SidebarChatRow
              key={chat.id}
              animateEntrance={animateEntrance}
              chat={chat}
              editingTitle={
                editingChat?.id === chat.id ? editingChat.title : ""
              }
              index={index}
              isActive={isActive}
              isEditing={editingChat?.id === chat.id}
              onCancelRename={() => {
                setEditingChat(null);
              }}
              onDelete={onDeleteChat}
              onEditingTitleChange={(title) => {
                setEditingChat({ id: chat.id, title });
              }}
              onRenameKeyDown={handleRenameKeyDown}
              onRenameSubmit={submitRenameChat}
              onSelect={handleSelectChat}
              onStartRename={startRenameChat}
            />
          );
        })}
      </nav>
    </>
  );
};

const SidebarFooter = ({
  animateEntrance,
  onRequestClose,
}: Pick<SidebarContentProps, "animateEntrance" | "onRequestClose">) => (
  <SidebarEntrance
    animateEntrance={animateEntrance}
    className="mt-auto p-2"
    index={9}
  >
    <div className="flex items-center gap-1">
      <div className="squircle relative min-w-0 flex-1 rounded-md hover:bg-muted/60 dark:hover:bg-muted/40">
        <LinkButton
          aria-label="Settings"
          className="group relative z-10 w-full justify-start bg-transparent hover:bg-transparent active:scale-100"
          onClick={onRequestClose}
          search={{
            from: "/",
          }}
          variant="ghost"
          to="/settings"
        >
          <HugeiconsIcon
            className="size-4 shrink-0"
            icon={Settings01Icon}
            strokeWidth={1.5}
          />
          Settings
        </LinkButton>
      </div>
      <SidebarHelpMenu onRequestClose={onRequestClose} />
    </div>
  </SidebarEntrance>
);

const SidebarContent = ({
  activeChatId,
  animateEntrance,
  chats,
  defaultMailboxId,
  embedded = false,
  onCreateChat,
  onDeleteChat,
  onRenameChat,
  groups,
  onComposeNewMail,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onRequestClose,
  onSelectMailbox,
  onSelectChat,
  onSelectMailboxId,
  onSelectView,
  onSetDefaultMailbox,
  onSearch,
  reconnectingMailboxId,
  searchQuery,
  selectedMailboxId,
  selectedMailbox,
  selectedMailboxProvider,
  selectedView,
  switcherSide = "right",
}: SidebarContentProps) => {
  const isInboxView =
    embedded || selectedView === "inbox" || selectedView === "labels";
  const isChatView = !embedded && selectedView === "chat";
  const isApiMailbox = selectedMailboxProvider === "api";
  const handleSelectMailboxId = (mailboxId: string) => {
    onSelectMailboxId(mailboxId);
    onRequestClose?.();
  };

  const handleSelectView = (view: MailboxWorkspaceView) => {
    onSelectView(view);
    onRequestClose?.();
  };

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col p-6">
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="flex min-w-0 items-start gap-2 rounded-md px-1"
      >
        <MailboxSwitcherDropdown
          defaultMailboxId={defaultMailboxId}
          embedded={embedded}
          groups={groups}
          onReorderMailboxSwitcher={onReorderMailboxSwitcher}
          onReconnectMailbox={onReconnectMailbox}
          onSelectMailboxId={handleSelectMailboxId}
          onSetDefaultMailbox={onSetDefaultMailbox}
          reconnectingMailboxId={reconnectingMailboxId}
          selectedMailboxId={selectedMailboxId}
          side={switcherSide}
        />

        {onRequestClose && (
          <IconButtonTooltip label="Close sidebar">
            <Button
              aria-label="Close sidebar"
              className="lg:hidden"
              onClick={onRequestClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        )}
      </SidebarEntrance>

      {!embedded && !isApiMailbox && (
        <div className="mt-2 p-1">
          <SidebarWorkspaceViewSwitch
            animateEntrance={animateEntrance}
            onSelectView={handleSelectView}
            selectedView={selectedView}
          />
        </div>
      )}

      {isInboxView && (
        <SidebarInboxSection
          animateEntrance={animateEntrance}
          embedded={embedded}
          groups={groups}
          onComposeNewMail={onComposeNewMail}
          onManageLabels={() => {
            handleSelectView("labels");
          }}
          onRequestClose={onRequestClose}
          onSearch={onSearch}
          onSelectMailbox={onSelectMailbox}
          searchQuery={searchQuery}
          selectedMailbox={selectedMailbox}
          selectedMailboxId={selectedMailboxId}
          selectedMailboxProvider={selectedMailboxProvider}
        />
      )}

      {isChatView && (
        <SidebarChatSection
          activeChatId={activeChatId}
          animateEntrance={animateEntrance}
          chats={chats}
          onCreateChat={onCreateChat}
          onDeleteChat={onDeleteChat}
          onRenameChat={onRenameChat}
          onRequestClose={onRequestClose}
          onSelectChat={onSelectChat}
        />
      )}

      {!embedded && (
        <SidebarFooter
          animateEntrance={animateEntrance}
          onRequestClose={onRequestClose}
        />
      )}
    </div>
  );
};

export const MailSidebar = ({
  isMobileOpen,
  onMobileOpenChange,
  ...sidebarProps
}: MailSidebarProps) => {
  const [animateEntrance, setAnimateEntrance] = useState(
    () => !hasPlayedSidebarEntrance
  );

  useEffect((): (() => void) | undefined => {
    if (!animateEntrance) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      hasPlayedSidebarEntrance = true;
      setAnimateEntrance(false);
    }, 650);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [animateEntrance]);

  return (
    <WorkspaceSidebar
      isMobileOpen={isMobileOpen}
      onMobileOpenChange={onMobileOpenChange}
      label="Mail sidebar"
    >
      {(close) => (
        <SidebarContent
          {...sidebarProps}
          animateEntrance={animateEntrance}
          onRequestClose={close}
          switcherSide={close ? "bottom" : undefined}
        />
      )}
    </WorkspaceSidebar>
  );
};
