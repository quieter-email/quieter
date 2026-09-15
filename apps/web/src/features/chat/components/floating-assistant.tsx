"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Delete02Icon,
  Edit01Icon,
  Tick01Icon,
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
import {
  AnimatePresence,
  motion,
  stagger,
  useDragControls,
} from "motion/react";
import type { Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode, SubmitEvent } from "react";

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

const panelVariants: Variants = {
  closed: {
    opacity: 0,
    scale: 0.94,
    transition: { damping: 34, stiffness: 400, type: "spring" },
  },
  open: {
    opacity: 1,
    scale: 1,
    transition: {
      damping: 30,
      delayChildren: stagger(0.07, { startDelay: 0.06 }),
      stiffness: 380,
      type: "spring",
    },
  },
};

const panelSectionVariants: Variants = {
  closed: { opacity: 0, y: 10 },
  open: {
    opacity: 1,
    transition: { damping: 32, stiffness: 420, type: "spring" },
    y: 0,
  },
};

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
  const dragControls = useDragControls();
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

  const startPanelDrag = (event: PointerEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, textarea, select")
    ) {
      return;
    }
    dragControls.start(event);
  };

  return (
    <>
      <motion.dialog
        open={open}
        aria-label="Quieter assistant"
        aria-hidden={!open}
        inert={!open}
        data-assistant-panel
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            minimize();
          }
        }}
        ref={panelRef}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        layout="size"
        initial={false}
        variants={panelVariants}
        animate={open ? "open" : "closed"}
        transition={{ damping: 34, stiffness: 380, type: "spring" }}
        className={cn(
          "fixed top-auto right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-auto z-50 m-0 flex w-[400px] max-w-[calc(100vw-2rem)] origin-bottom-right flex-col overflow-hidden rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] p-0 text-fg shadow-elevation backdrop-blur-2xl max-sm:right-[max(1rem,env(safe-area-inset-right))] max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))] max-sm:left-[max(1rem,env(safe-area-inset-left))] max-sm:w-auto max-sm:max-w-none",
          { "pointer-events-none invisible": !open }
        )}
      >
        <motion.header
          className="flex h-10 shrink-0 cursor-grab touch-none items-center gap-2 px-4 select-none active:cursor-grabbing"
          layout
          onPointerDown={startPanelDrag}
          variants={panelSectionVariants}
        >
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
              // oxlint-disable-next-line shadcn/no-restyle -- Assistant panel keeps its menu sizing.
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
                      <span className="truncate">{getChatTitle(chat)}</span>
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
                        // oxlint-disable-next-line shadcn/no-restyle -- Rename input keeps caption type.
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
                      <IconButtonTooltip label="Confirm rename">
                        <Button
                          aria-label="Confirm rename"
                          disabled={renameTitle.trim() === ""}
                          size="icon-sm"
                          type="submit"
                          variant="ghost"
                        >
                          <HugeiconsIcon
                            aria-hidden
                            className="size-3.5"
                            icon={Tick01Icon}
                          />
                        </Button>
                      </IconButtonTooltip>
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
          <div className="ml-auto flex items-center gap-1">
            <IconButtonTooltip label="Close assistant">
              <Button
                aria-label="Close assistant"
                onClick={minimize}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
              </Button>
            </IconButtonTooltip>
          </div>
        </motion.header>
        <motion.div className="min-h-0" layout variants={panelSectionVariants}>
          {children}
        </motion.div>
      </motion.dialog>
      <AnimatePresence>
        {open ? null : (
          <IconButtonTooltip label="Open Quieter">
            <motion.button
              aria-label="Open Quieter"
              animate={{ opacity: 1, scale: 1 }}
              className="fixed right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex size-12 items-center justify-center rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] text-fg shadow-elevation backdrop-blur-2xl focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none max-sm:right-[max(1rem,env(safe-area-inset-right))] max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))]"
              data-assistant-launcher
              exit={{ opacity: 0, scale: 0.8 }}
              initial={{ opacity: 0, scale: 0.8 }}
              onClick={onOpen}
              transition={{ damping: 26, stiffness: 380, type: "spring" }}
              type="button"
              ref={launcherRef}
            >
              <Brand className="size-7" />
            </motion.button>
          </IconButtonTooltip>
        )}
      </AnimatePresence>
    </>
  );
};
