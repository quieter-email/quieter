"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  Edit01Icon,
  MinusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brand } from "@quieter/ui/brand";
import { Button } from "@quieter/ui/button";
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
import { useEffect, useRef, useState } from "react";
import type { SubmitEvent, ReactNode } from "react";

export type FloatingAssistantChat = {
  id: string;
  title: string | null;
};

type FloatingAssistantProps = {
  activeChatId: string | null;
  chats: FloatingAssistantChat[];
  children: ReactNode;
  onDeleteChat: (chatId: string) => void;
  onMinimize: () => void;
  onNewChat: () => void;
  onOpen: () => void;
  onRenameChat: (chatId: string, title: string) => void;
  onChatSelect: (chatId: string) => void;
  open: boolean;
};

const getChatTitle = (chat: FloatingAssistantChat) =>
  chat.title?.trim() || "New chat";

export const FloatingAssistant = ({
  activeChatId,
  chats,
  children,
  onDeleteChat,
  onMinimize,
  onNewChat,
  onOpen,
  onRenameChat,
  onChatSelect,
  open,
}: FloatingAssistantProps) => {
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const previousOpenRef = useRef(open);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const [renamingChat, setRenamingChat] =
    useState<FloatingAssistantChat | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const startRename = () => {
    if (activeChat === undefined) {
      return;
    }
    setRenamingChat(activeChat);
    setRenameTitle(getChatTitle(activeChat));
  };

  const submitRename = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = renameTitle.trim();
    if (renamingChat === null || title === "") {
      setRenamingChat(null);
      return;
    }
    onRenameChat(renamingChat.id, title);
    setRenamingChat(null);
  };

  useEffect((): (() => void) | undefined => {
    if (open && !previousOpenRef.current) {
      const animationFrame = window.requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLTextAreaElement>("[data-assistant-composer]")
          ?.focus();
      });
      previousOpenRef.current = open;
      return () => {
        window.cancelAnimationFrame(animationFrame);
      };
    }
    previousOpenRef.current = open;
    return undefined;
  }, [open]);

  const minimize = () => {
    onMinimize();
    window.requestAnimationFrame(() => {
      launcherRef.current?.focus();
    });
  };

  return (
    <>
      <dialog
        open={open}
        aria-label="Quieter assistant"
        aria-hidden={!open}
        data-assistant-panel
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            minimize();
          }
        }}
        ref={panelRef}
        className={cn(
          "fixed top-auto right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-auto z-50 m-0 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] p-0 text-fg shadow-elevation backdrop-blur-2xl max-sm:right-[max(1rem,env(safe-area-inset-right))] max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))] max-sm:left-[max(1rem,env(safe-area-inset-left))] max-sm:w-auto max-sm:max-w-none",
          { hidden: !open }
        )}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 px-4">
          <DropdownMenu>
            <DropdownMenuTrigger
              appearance="row-strong"
              aria-label="Open conversation history"
              type="button"
            >
              <span className="truncate">Quieter</span>
              <HugeiconsIcon
                aria-hidden
                className="size-3.5 text-muted-fg"
                icon={ArrowDown01Icon}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-72 p-1.5"
              sideOffset={8}
              data-assistant-panel
            >
              <p className="px-2 py-1.5 text-caption text-muted-fg">
                Conversations
              </p>
              <div className="max-h-56 overflow-y-auto">
                {chats.length === 0 ? (
                  <p className="px-2 py-3 text-caption text-muted-fg">
                    No conversations yet
                  </p>
                ) : (
                  chats.map((chat) => (
                    <DropdownMenuItem
                      className={cn("w-full", {
                        "bg-muted": chat.id === activeChatId,
                      })}
                      key={chat.id}
                      onSelect={() => {
                        onChatSelect(chat.id);
                      }}
                    >
                      <span className="truncate">{getChatTitle(chat)}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
              {activeChat === undefined ? null : (
                <>
                  <DropdownMenuSeparator />
                  {renamingChat?.id === activeChat.id ? (
                    <form className="px-1 py-1" onSubmit={submitRename}>
                      <Input
                        aria-label="Conversation title"
                        className="h-8 text-caption"
                        onChange={(event) => {
                          setRenameTitle(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenamingChat(null);
                          }
                        }}
                        value={renameTitle}
                      />
                    </form>
                  ) : (
                    <DropdownMenuItem
                      closeOnSelect={false}
                      onSelect={startRename}
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className="size-3.5"
                        icon={Edit01Icon}
                      />
                      Rename conversation
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => {
                      onDeleteChat(activeChat.id);
                    }}
                    tone="destructive"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className="size-3.5"
                      icon={Delete02Icon}
                    />
                    Delete conversation
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-1">
            <IconButtonTooltip label="New conversation">
              <Button
                aria-label="New conversation"
                onClick={onNewChat}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon aria-hidden icon={Add01Icon} />
              </Button>
            </IconButtonTooltip>
            <IconButtonTooltip label="Minimize assistant">
              <Button
                aria-label="Minimize assistant"
                onClick={minimize}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon aria-hidden icon={MinusSignIcon} />
              </Button>
            </IconButtonTooltip>
          </div>
        </header>
        <div className="min-h-0">{children}</div>
      </dialog>
      {open ? null : (
        <IconButtonTooltip label="Open Quieter">
          <button
            aria-label="Open Quieter"
            className="fixed right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex size-12 items-center justify-center rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] text-fg shadow-elevation backdrop-blur-2xl transition-transform duration-150 hover:scale-105 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 max-sm:right-[max(1rem,env(safe-area-inset-right))] max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))]"
            data-assistant-launcher
            onClick={onOpen}
            type="button"
            ref={launcherRef}
          >
            <Brand className="size-7" />
          </button>
        </IconButtonTooltip>
      )}
    </>
  );
};
