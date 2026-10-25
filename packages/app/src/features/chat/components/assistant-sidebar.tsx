"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  Edit01Icon,
  LayoutRightIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import {
  workspaceSectionVariants,
  workspaceGutterClassName,
} from "@quieter/ui/workspace-section";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, SubmitEvent } from "react";

export type AssistantSidebarChat = { id: string; title: string | null };

type AssistantSidebarProps = {
  activeChatId: string | null;
  chats: AssistantSidebarChat[];
  children: ReactNode;
  focusRequest: number;
  id: string;
  onChatSelect: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onMinimize: () => void;
  onNewChat: () => void;
  onRenameChat: (chatId: string, title: string) => void;
  open: boolean;
};

export const AssistantSidebar = ({
  activeChatId,
  chats,
  children,
  focusRequest,
  id,
  onChatSelect,
  onDeleteChat,
  onMinimize,
  onNewChat,
  onRenameChat,
  open,
}: AssistantSidebarProps) => {
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const previousFocusRequestRef = useRef(focusRequest);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const [renamingChat, setRenamingChat] = useState<AssistantSidebarChat | null>(
    null
  );
  const [renameTitle, setRenameTitle] = useState("");

  const startRename = () => {
    if (activeChat === undefined) {
      return;
    }
    setRenamingChat(activeChat);
    setRenameTitle(activeChat.title?.trim() || "New chat");
  };
  const submitRename = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = renameTitle.trim();
    if (renamingChat !== null && title !== "") {
      onRenameChat(renamingChat.id, title);
    }
    setRenamingChat(null);
  };

  useEffect((): (() => void) | undefined => {
    const requested = focusRequest !== previousFocusRequestRef.current;
    previousFocusRequestRef.current = focusRequest;
    if (!open || !requested) {
      return undefined;
    }
    const panel = panelRef.current;
    const observer = new MutationObserver(() => {
      const composer = panel?.querySelector<HTMLElement>(
        "[data-assistant-composer]"
      );
      if (composer && document.activeElement === panel) {
        composer.focus();
        observer.disconnect();
      }
    });
    const frame = window.requestAnimationFrame(() => {
      const composer = panel?.querySelector<HTMLElement>(
        "[data-assistant-composer]"
      );
      (composer ?? panel)?.focus();
      if (!composer && panel) {
        observer.observe(panel, { childList: true, subtree: true });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [focusRequest, open]);

  return (
    <aside
      aria-hidden={!open}
      aria-label="Quieter assistant"
      className={cn(
        workspaceGutterClassName,
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- Width reserves space as the adjacent mailbox resizes with the sidebar.
        "absolute inset-y-0 right-0 z-20 w-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none xl:relative xl:inset-auto",
        {
          "pointer-events-none xl:w-0": !open,
          "xl:w-[clamp(20rem,26vw,25rem)]": open,
        }
      )}
      data-assistant-sidebar
      id={id}
      inert={!open}
    >
      {/* Reserve the sidebar's width while translating a stable-width panel, so the mailbox and assistant move together without scaling text. */}
      <div
        className={cn(
          // oxlint-disable-next-line shadcn/no-arbitrary-values -- Visibility changes after the sidebar's translate and opacity transition.
          "absolute inset-y-0 right-0 w-full p-(--workspace-gutter) transition-[transform,opacity,visibility] duration-200 ease-out motion-reduce:transition-none xl:w-[clamp(20rem,26vw,25rem)] xl:pl-0",
          {
            "invisible translate-x-full opacity-0": !open,
            "visible translate-x-0 opacity-100": open,
          }
        )}
        data-assistant-surface
      >
        <dialog
          aria-label="Quieter assistant"
          className={cn(
            workspaceSectionVariants({ layout: "surface" }),
            "relative m-0 h-full w-full p-0 text-fg"
          )}
          data-assistant-panel
          open
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              onMinimize();
            }
          }}
          ref={panelRef}
          tabIndex={-1}
        >
          <header className="flex shrink-0 items-center gap-2 p-4">
            <DropdownMenu key={open ? "visible" : "hidden"}>
              <DropdownMenuTrigger
                appearance="row-strong"
                aria-label="Open conversation history"
                type="button"
              >
                <span className="max-w-40 truncate">
                  {activeChat
                    ? activeChat.title?.trim() || "New chat"
                    : "New chat"}
                </span>
                <Icon
                  aria-hidden
                  size={14}
                  tone="muted"
                  icon={ArrowDown01Icon}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-72"
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
                        // oxlint-disable-next-line shadcn/no-restyle -- Active conversation keeps its highlight.
                        className={cn("w-full", {
                          // oxlint-disable-next-line shadcn/no-restyle -- Active conversation keeps its highlight.
                          "bg-muted": chat.id === activeChatId,
                        })}
                        key={chat.id}
                        onSelect={() => {
                          onChatSelect(chat.id);
                        }}
                      >
                        <span className="truncate">
                          {chat.title?.trim() || "New chat"}
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                </div>
                {activeChat === undefined ? null : (
                  <>
                    <DropdownMenuSeparator />
                    {renamingChat?.id === activeChat.id ? (
                      <form
                        className="flex items-center gap-1 px-1 py-1"
                        onSubmit={submitRename}
                      >
                        <Input
                          aria-label="Conversation title"
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
                        <IconButtonTooltip label="Confirm rename">
                          <Button
                            aria-label="Confirm rename"
                            disabled={renameTitle.trim() === ""}
                            size="icon-sm"
                            type="submit"
                            variant="ghost"
                          >
                            <Icon aria-hidden size={14} icon={Tick01Icon} />
                          </Button>
                        </IconButtonTooltip>
                      </form>
                    ) : (
                      <DropdownMenuItem
                        closeOnSelect={false}
                        onSelect={startRename}
                      >
                        <Icon aria-hidden size={14} icon={Edit01Icon} />
                        Rename conversation
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => {
                        onDeleteChat(activeChat.id);
                      }}
                      tone="destructive"
                    >
                      <Icon aria-hidden size={14} icon={Delete02Icon} />
                      Delete conversation
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButtonTooltip label="New conversation">
              <Button
                aria-label="New conversation"
                onClick={onNewChat}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icon aria-hidden icon={Add01Icon} />
              </Button>
            </IconButtonTooltip>
            <div className="ml-auto flex items-center gap-1">
              <IconButtonTooltip label="Collapse assistant sidebar">
                <Button
                  aria-controls={id}
                  aria-expanded={open}
                  aria-label="Collapse assistant sidebar"
                  onClick={onMinimize}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden icon={LayoutRightIcon} />
                </Button>
              </IconButtonTooltip>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </dialog>
      </div>
    </aside>
  );
};
