"use client";

import {
  Cancel01Icon,
  ChatAddIcon,
  Delete01Icon,
  Edit01Icon,
  Loading03Icon,
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
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import {
  type MailboxSwitcherOrder,
  MailboxSwitcherDropdown,
} from "~/features/navigation/components/mailbox-switcher";
import { ManagedMailboxOrganizer } from "~/features/navigation/components/managed-mailbox-organizer";
import { SidebarLabelNav } from "~/features/navigation/components/sidebar-label-nav";
import { SidebarMailboxNav } from "~/features/navigation/components/sidebar-mailbox-nav";
import { SidebarSimpleHoverSurface } from "~/features/navigation/components/sidebar-surfaces";
import { SidebarWorkspaceViewSwitch } from "~/features/navigation/components/sidebar-workspace-view-switch";

type MailSidebarProps = {
  activeChatId: string | null;
  chats: Array<{
    id: string;
    isGenerating: boolean;
    title: string | null;
    updatedAt: Date;
  }>;
  defaultMailboxId: string | null;
  embedded?: boolean;
  groups: Array<{
    id: string;
    kind: "division" | "organization" | "unassigned";
    mailboxes: Array<{
      connectionStatus: "connected" | "needs_reconnect";
      divisionName?: string | null;
      grantRole?: "manager" | "reader" | "responder" | null;
      id: string;
      emailAddress: string;
      displayName: string | null;
      groupName: string;
      provider: string;
      unreadNonSpamCount: number;
    }>;
    name: string;
  }>;
  selectedMailboxId: string | null;
  selectedMailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory;
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
  onSelectView: (view: MailboxWorkspaceView) => void;
  reconnectingMailboxId: string | null;
  searchQuery: string;
  selectedView: MailboxWorkspaceView;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

type SidebarContentProps = Omit<MailSidebarProps, "isMobileOpen" | "onMobileOpenChange"> & {
  animateEntrance: boolean;
  onRequestClose?: () => void;
  switcherSide?: "bottom" | "right";
};

const getSidebarEntranceDelay = (step: number) => step * 0.1;

const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(8px)" } : false;

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
  onRenameSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (chatId: string) => void;
  onStartRename: (chat: SidebarChat) => void;
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
  const title = chat.title?.trim() || "New chat";

  return (
    <m.div
      key={chat.id}
      className="w-full will-change-[transform,opacity,filter]"
      initial={getSidebarEntranceInitial(animateEntrance)}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{
        delay: getSidebarEntranceDelay(index + 3),
        duration: 0.5,
        ease: "easeOut",
      }}
    >
      {isEditing ? (
        <form className="w-full" onSubmit={onRenameSubmit}>
          <Input
            aria-label="Rename chat"
            autoFocus
            className="h-8"
            onBlur={onCancelRename}
            onChange={(event) => onEditingTitleChange(event.target.value)}
            onKeyDown={onRenameKeyDown}
            size="sm"
            value={editingTitle}
          />
        </form>
      ) : (
        <div
          className={cn(
            "group flex h-8 w-full items-center overflow-hidden rounded-md transition-colors",
            {
              "bg-secondary/55": isActive,
              "hover:bg-secondary/35": !isActive,
            },
          )}
        >
          <Button
            aria-current={isActive ? "page" : undefined}
            className="h-full min-w-0 flex-1 justify-start gap-3 rounded-none bg-transparent px-3 text-left text-foreground hover:bg-transparent"
            onClick={() => onSelect(chat.id)}
            type="button"
            variant="ghost"
          >
            {chat.isGenerating && (
              <HugeiconsIcon
                aria-hidden
                className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                icon={Loading03Icon}
              />
            )}
            <span className="truncate">{title}</span>
          </Button>
          <DropdownMenu>
            <IconButtonTooltip label={`Options for "${title}"`}>
              <DropdownMenuTrigger
                aria-label={`Options for "${title}"`}
                className="pointer-events-none mr-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-sm border-l border-border/40 bg-background/15 text-muted-foreground opacity-0 transition-[opacity,background-color,color] outline-none group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-background/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20 data-popup-open:pointer-events-auto data-popup-open:opacity-100"
              >
                <HugeiconsIcon aria-hidden className="size-3.5" icon={MoreVerticalIcon} />
              </DropdownMenuTrigger>
            </IconButtonTooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onStartRename(chat)}>
                <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(chat.id)}>
                <HugeiconsIcon aria-hidden className="size-4" icon={Delete01Icon} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </m.div>
  );
};

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
  const isInboxView = embedded || selectedView === "inbox";
  const isApiMailbox = selectedMailboxProvider === "api";
  const selectedMailboxGrantRole = groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === selectedMailboxId)?.grantRole;
  const [editingChat, setEditingChat] = useState<{ id: string; title: string } | null>(null);
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);

  const handleComposeNewMail = () => {
    onComposeNewMail();
    onRequestClose?.();
  };

  const handleSelectMailbox = (mailbox: MailboxCategory) => {
    onSelectMailbox(mailbox);
    onRequestClose?.();
  };

  const handleSelectMailboxId = (mailboxId: string) => {
    onSelectMailboxId(mailboxId);
    onRequestClose?.();
  };

  const handleSelectView = (view: MailboxWorkspaceView) => {
    onSelectView(view);
    onRequestClose?.();
  };

  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId);
    onRequestClose?.();
  };

  const startRenameChat = (chat: { id: string; title: string | null }) => {
    setEditingChat({ id: chat.id, title: chat.title?.trim() || "New chat" });
  };

  const submitRenameChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const title = editingChat?.title.trim();
    if (!editingChat || !title) {
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
    <div className="relative z-10 flex min-h-0 flex-1 flex-col p-6">
      <m.div
        className="flex min-w-0 items-start gap-2 rounded-md px-1 will-change-[transform,opacity,filter]"
        initial={getSidebarEntranceInitial(animateEntrance)}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ delay: getSidebarEntranceDelay(0), duration: 0.5, ease: "easeOut" }}
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
      </m.div>

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
        <m.div
          className="mt-3 p-1 will-change-[transform,opacity,filter]"
          initial={getSidebarEntranceInitial(animateEntrance)}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          transition={{ delay: getSidebarEntranceDelay(2), duration: 0.5, ease: "easeOut" }}
        >
          <Button
            aria-disabled={embedded || isApiMailbox}
            className="w-full justify-start rounded-md px-4"
            disabled={!selectedMailboxId || embedded || isApiMailbox}
            onClick={handleComposeNewMail}
            type="button"
          >
            <HugeiconsIcon className="size-4 shrink-0" icon={Edit01Icon} strokeWidth={1.5} />
            Compose
          </Button>
        </m.div>
      )}

      {isInboxView && (
        <div className="mt-2 min-h-0 flex-1 p-1">
          <SidebarMailboxNav
            animateEntrance={animateEntrance}
            mailboxProvider={selectedMailboxProvider}
            onSelectMailbox={handleSelectMailbox}
            selectedMailbox={selectedMailbox}
          />
          {selectedMailboxProvider === "managed" && selectedMailboxId ? (
            <ManagedMailboxOrganizer
              canManage={selectedMailboxGrantRole === "manager"}
              mailboxId={selectedMailboxId}
              onSearch={(query) => {
                onSearch(query);
                onRequestClose?.();
              }}
              searchQuery={searchQuery}
            />
          ) : null}
          {selectedMailboxProvider !== "api" && (
            <SidebarLabelNav
              animateEntrance={animateEntrance}
              canManage={
                !embedded &&
                (selectedMailboxProvider === "gmail" || selectedMailboxGrantRole === "manager")
              }
              mailboxId={selectedMailboxId}
              mailboxProvider={selectedMailboxProvider ?? "gmail"}
              onSearch={(query) => {
                onSearch(query);
                onRequestClose?.();
              }}
              searchQuery={searchQuery}
            />
          )}
        </div>
      )}

      {!isInboxView && (
        <>
          <m.div
            className="mt-3 p-1 will-change-[transform,opacity,filter]"
            initial={getSidebarEntranceInitial(animateEntrance)}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ delay: getSidebarEntranceDelay(2), duration: 0.5, ease: "easeOut" }}
          >
            <Button
              className="w-full justify-start rounded-md px-4"
              onClick={() => {
                onCreateChat();
                onRequestClose?.();
              }}
              type="button"
            >
              <HugeiconsIcon className="size-4 shrink-0" icon={ChatAddIcon} strokeWidth={1.5} />
              New chat
            </Button>
          </m.div>

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
                  editingTitle={editingChat?.id === chat.id ? editingChat.title : ""}
                  index={index}
                  isActive={isActive}
                  isEditing={editingChat?.id === chat.id}
                  onCancelRename={() => setEditingChat(null)}
                  onDelete={onDeleteChat}
                  onEditingTitleChange={(title) => setEditingChat({ id: chat.id, title })}
                  onRenameKeyDown={handleRenameKeyDown}
                  onRenameSubmit={submitRenameChat}
                  onSelect={handleSelectChat}
                  onStartRename={startRenameChat}
                />
              );
            })}
          </nav>
        </>
      )}

      {!embedded && (
        <m.div
          className="mt-auto p-2 will-change-[transform,opacity,filter]"
          initial={getSidebarEntranceInitial(animateEntrance)}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
        >
          <div
            className="relative rounded-md squircle"
            onMouseEnter={() => setIsSettingsHovered(true)}
            onMouseLeave={() => setIsSettingsHovered(false)}
          >
            <SidebarSimpleHoverSurface
              layoutId="sidebar-settings-hover"
              visible={isSettingsHovered}
            />
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
                className="size-4 shrink-0 rotate-0 transition-transform duration-1000 ease-in-out group-hover:rotate-360"
                icon={Settings01Icon}
                strokeWidth={1.5}
              />
              Settings
            </LinkButton>
          </div>
        </m.div>
      )}
    </div>
  );
};

export const MailSidebar = ({
  isMobileOpen,
  onMobileOpenChange,
  ...sidebarProps
}: MailSidebarProps) => {
  const [animateEntrance, setAnimateEntrance] = useState(() => !hasPlayedSidebarEntrance);
  const closeMobileSidebar = useEffectEvent(() => {
    onMobileOpenChange(false);
  });

  useEffect(() => {
    if (!animateEntrance) {
      return;
    }

    hasPlayedSidebarEntrance = true;
    const frame = requestAnimationFrame(() => setAnimateEntrance(false));
    return () => cancelAnimationFrame(frame);
  }, [animateEntrance]);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileSidebar();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileOpen]);

  return (
    <LazyMotion features={domMax}>
      <>
        <aside
          className="relative hidden h-full shrink-0 bg-transparent text-foreground lg:flex lg:flex-col"
          style={{ width: "272px" }}
        >
          <SidebarContent {...sidebarProps} animateEntrance={animateEntrance} />
        </aside>

        <AnimatePresence initial={false}>
          {isMobileOpen && (
            <>
              <m.button
                aria-label="Close sidebar"
                className="fixed inset-0 z-40 bg-background-dark/50 backdrop-blur-[2px] lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => onMobileOpenChange(false)}
                type="button"
              />
              <m.aside
                aria-label="Mail sidebar"
                className="fixed inset-y-0 left-0 isolate z-50 flex w-[min(20rem,calc(100vw-2.5rem))] flex-col overflow-hidden bg-background-dark pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl lg:hidden"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", bounce: 0, duration: 0.24 }}
              >
                <WorkspaceDitherBackground />
                <SidebarContent
                  {...sidebarProps}
                  animateEntrance={animateEntrance}
                  onRequestClose={() => onMobileOpenChange(false)}
                  switcherSide="bottom"
                />
              </m.aside>
            </>
          )}
        </AnimatePresence>
      </>
    </LazyMotion>
  );
};
