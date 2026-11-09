"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  Edit01Icon,
  LayoutRightIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { useReminderList } from "@quieter/app/features/reminders/reminder-query";
import { RemindersPanel } from "@quieter/app/features/reminders/reminders-panel";
import type { ReminderOpenRequest } from "@quieter/app/features/reminders/reminders-panel";
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
import { Tabs, TabsList, TabsTab } from "@quieter/ui/tabs";
import {
  WorkspaceHeader,
  workspaceSectionVariants,
  workspaceGutterClassName,
} from "@quieter/ui/workspace-section";
import { Activity, useEffect, useRef, useState } from "react";
import type { ReactNode, SubmitEvent } from "react";

import { SemanticHistorySearch } from "./semantic-history-search";

export type AssistantSidebarChat = { id: string; title: string | null };

type AssistantSidebarProps = {
  tab: "chat" | "reminders";
  onTabChange: (tab: "chat" | "reminders") => void;
  reminderRequest: ReminderOpenRequest | null;
  demo: boolean;
  activeChatId: string | null;
  chats: AssistantSidebarChat[];
  children: ReactNode;
  focusRequest: number;
  id: string;
  mailboxId: string;
  onChatSelect: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onMinimize: () => void;
  onNewChat: () => void;
  onRenameChat: (chatId: string, title: string) => void;
  open: boolean;
};

export const AssistantSidebar = ({
  tab,
  onTabChange,
  reminderRequest,
  demo,
  activeChatId,
  chats,
  children,
  focusRequest,
  id,
  mailboxId,
  onChatSelect,
  onDeleteChat,
  onMinimize,
  onNewChat,
  onRenameChat,
  open,
}: AssistantSidebarProps) => {
  const reminders = useReminderList(mailboxId, "active", demo);
  const reminderCount =
    reminders.data?.items.filter((reminder) => reminder.status === "active")
      .length ?? 0;
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const previousFocusRequestRef = useRef(focusRequest);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const [renamingChat, setRenamingChat] = useState<AssistantSidebarChat | null>(
    null
  );
  const [renameTitle, setRenameTitle] = useState("");
  const [historySearchOpen, setHistorySearchOpen] = useState(false);

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
    if (tab === "reminders") {
      const frame = window.requestAnimationFrame(() => {
        panel?.focus({ preventScroll: true });
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    const observer = new MutationObserver(() => {
      const composer = panel?.querySelector<HTMLElement>(
        "[data-assistant-composer]:not(:disabled)"
      );
      if (composer && document.activeElement === panel) {
        composer.focus({ preventScroll: true });
        observer.disconnect();
      }
    });
    const frame = window.requestAnimationFrame(() => {
      const composer = panel?.querySelector<HTMLElement>(
        "[data-assistant-composer]:not(:disabled)"
      );
      (composer ?? panel)?.focus({ preventScroll: true });
      if (!composer && panel) {
        observer.observe(panel, {
          attributeFilter: ["disabled"],
          childList: true,
          subtree: true,
        });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [focusRequest, open, tab]);

  return (
    <aside
      aria-hidden={!open}
      aria-label="quieter assistant"
      className={cn(workspaceGutterClassName, "relative h-full w-full")}
      data-assistant-sidebar
      id={id}
      inert={!open}
    >
      <SemanticHistorySearch
        key={mailboxId}
        mailboxId={mailboxId}
        onChatSelect={onChatSelect}
        onOpenChange={setHistorySearchOpen}
        open={open && historySearchOpen}
      />
      <div
        className="absolute inset-0 p-(--workspace-gutter) xl:pl-0"
        data-assistant-surface
      >
        <dialog
          aria-label="quieter assistant"
          className={cn(
            workspaceSectionVariants({ layout: "surface" }),
            "relative m-0 h-full w-full p-0 text-fg outline-hidden"
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
          <WorkspaceHeader>
            <div className="flex items-center justify-between gap-2">
              <Tabs
                value={tab}
                onValueChange={(value: unknown) => {
                  if (value === "chat" || value === "reminders") {
                    onTabChange(value);
                  }
                }}
              >
                <TabsList aria-label="Assistant view" variant="plain">
                  <TabsTab value="chat">Chat</TabsTab>
                  <TabsTab value="reminders">
                    Reminders
                    {reminderCount > 0 ? (
                      <span className="text-caption text-muted-fg">
                        {reminderCount}
                      </span>
                    ) : null}
                  </TabsTab>
                </TabsList>
              </Tabs>
              <IconButtonTooltip label="Collapse assistant sidebar">
                <Button
                  chrome="toolbar"
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
          </WorkspaceHeader>
          <div hidden={tab !== "chat"}>
            <WorkspaceHeader>
              <div className="flex items-center gap-2">
                <DropdownMenu key={open ? "visible" : "hidden"}>
                  <DropdownMenuTrigger
                    chrome="toolbar"
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
                    <DropdownMenuItem
                      onSelect={() => {
                        setHistorySearchOpen(true);
                      }}
                    >
                      Search conversations and mail
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
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
                    chrome="toolbar"
                    aria-label="New conversation"
                    onClick={onNewChat}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Icon aria-hidden icon={Add01Icon} />
                  </Button>
                </IconButtonTooltip>
              </div>
            </WorkspaceHeader>
          </div>
          <div
            className={cn("min-h-0 flex-1 flex-col", {
              flex: tab === "chat",
              hidden: tab !== "chat",
            })}
            inert={tab !== "chat"}
          >
            {children}
          </div>
          <Activity mode={tab === "reminders" ? "visible" : "hidden"}>
            <div className="flex min-h-0 flex-1 flex-col">
              <RemindersPanel
                key={`${mailboxId}:${reminderRequest?.id ?? "list"}`}
                mailboxId={mailboxId}
                demo={demo}
                request={reminderRequest}
              />
            </div>
          </Activity>
        </dialog>
      </div>
    </aside>
  );
};
