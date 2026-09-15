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
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const boundsRef = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const reducedMotion = useReducedMotion() === true;
  const [panelSize, setPanelSize] = useState({ height: 48, width: 400 });

  useLayoutEffect((): (() => void) | undefined => {
    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      setPanelSize({
        height: panel.offsetHeight + 2,
        width: panel.offsetWidth + 2,
      });
    });
    observer.observe(panel);
    return () => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const keepInBounds = () => {
      const bounds = boundsRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }
      const width = open ? Math.min(panelSize.width, bounds.width) : 48;
      const height = open ? Math.min(panelSize.height, bounds.height) : 48;
      const nextX = Math.max(width - bounds.width, Math.min(0, x.get()));
      const nextY = Math.max(height - bounds.height, Math.min(0, y.get()));
      const transition = reducedMotion
        ? { duration: 0 }
        : { bounce: 0.08, duration: 0.3, type: "spring" as const };
      if (nextX !== x.get()) {
        animate(x, nextX, transition);
      }
      if (nextY !== y.get()) {
        animate(y, nextY, transition);
      }
    };
    keepInBounds();
    window.addEventListener("resize", keepInBounds);
    return () => {
      window.removeEventListener("resize", keepInBounds);
    };
  }, [open, panelSize, reducedMotion, x, y]);
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
    x.stop();
    y.stop();
    dragControls.start(event);
  };

  return (
    <div
      className="pointer-events-none fixed inset-[max(1.5rem,env(safe-area-inset-top),env(safe-area-inset-right),env(safe-area-inset-bottom),env(safe-area-inset-left))] z-50 max-sm:inset-[max(1rem,env(safe-area-inset-top),env(safe-area-inset-right),env(safe-area-inset-bottom),env(safe-area-inset-left))]"
      ref={boundsRef}
    >
      <motion.div
        drag
        dragConstraints={boundsRef}
        dragControls={dragControls}
        dragElastic={0}
        dragListener={false}
        dragMomentum={false}
        onDragStart={() => {
          draggedRef.current = true;
        }}
        // oxlint-disable-next-line shadcn/no-inline-styles -- Motion values keep dragging directly synchronized with the pointer.
        style={{ x, y }}
        initial={false}
        animate={{
          height: open ? panelSize.height : 48,
          width: open ? panelSize.width : 48,
        }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { bounce: 0.08, duration: 0.3, type: "spring" }
        }
        className="pointer-events-auto absolute right-0 bottom-0 max-h-full max-w-full overflow-hidden rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] text-fg shadow-elevation backdrop-blur-2xl"
      >
        <motion.dialog
          open
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
          initial={false}
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.12 }}
          className={cn(
            "absolute right-0 bottom-0 left-auto m-0 flex w-[398px] max-w-[calc(100dvw-3rem-2px)] flex-col border-0 bg-transparent p-0 pt-4 text-fg max-sm:max-w-[calc(100dvw-2rem-2px)]",
            { "pointer-events-none": !open }
          )}
        >
          <header
            className="flex h-7 shrink-0 cursor-grab touch-none items-center gap-2 px-4 select-none active:cursor-grabbing"
            onPointerDown={startPanelDrag}
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
          </header>
          <div className="min-h-0">{children}</div>
        </motion.dialog>
        <IconButtonTooltip label="Open Quieter">
          <motion.button
            aria-label="Open Quieter"
            aria-hidden={open}
            inert={open}
            tabIndex={open ? -1 : 0}
            initial={false}
            animate={{ opacity: open ? 0 : 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
            className={cn(
              "absolute right-0 bottom-0 flex size-[46px] cursor-grab touch-none items-center justify-center rounded-lg focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:cursor-grabbing",
              { "pointer-events-none": open }
            )}
            data-assistant-launcher
            onPointerDown={(event) => {
              draggedRef.current = false;
              x.stop();
              y.stop();
              dragControls.start(event);
            }}
            onClick={(event) => {
              if (event.detail === 0 || !draggedRef.current) {
                onOpen();
              }
            }}
            type="button"
            ref={launcherRef}
          >
            <Brand className="pointer-events-none size-7" />
          </motion.button>
        </IconButtonTooltip>
      </motion.div>
    </div>
  );
};
