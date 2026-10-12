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
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode, SubmitEvent } from "react";

import { useAssistantPosition } from "./use-assistant-position";

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
  const reducedMotion = useReducedMotion() === true;
  const [panelSize, setPanelSize] = useState({ height: 48, width: 400 });
  const {
    boundsRef,
    draggedRef,
    dragging,
    hasDock,
    nearDock,
    pendingEdge,
    dockX,
    dockY,
    x,
    y,
    tabX,
    tabY,
    edge,
    tucked,
    reveal,
    tuck,
    startDrag,
    moveDrag,
    endDrag,
  } = useAssistantPosition({ open, panelSize, reducedMotion });
  useLayoutEffect((): (() => void) | undefined => {
    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }
    let shrinkTimer: ReturnType<typeof setTimeout> | undefined;
    let settledHeight = 48;
    const measure = () => {
      clearTimeout(shrinkTimer);
      const loading = panel.querySelector("[data-assistant-loading]") !== null;
      const measuredHeight = panel.offsetHeight + 2;
      const height = loading
        ? Math.max(settledHeight, measuredHeight)
        : measuredHeight;
      const width = panel.offsetWidth + 2;
      if (height < settledHeight) {
        shrinkTimer = setTimeout(() => {
          settledHeight = height;
          setPanelSize({ height, width });
        }, 250);
      } else {
        settledHeight = height;
        setPanelSize((previous) =>
          previous.height === height && previous.width === width
            ? previous
            : { height, width }
        );
      }
    };
    const observer = new ResizeObserver(measure);
    const loadingObserver = new MutationObserver(measure);
    observer.observe(panel);
    loadingObserver.observe(panel, {
      attributeFilter: ["data-assistant-loading"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => {
      clearTimeout(shrinkTimer);
      observer.disconnect();
      loadingObserver.disconnect();
    };
  }, []);

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
    startDrag(event);
  };

  return (
    <div
      className="pointer-events-none fixed inset-[max(1.5rem,env(safe-area-inset-top),env(safe-area-inset-right),env(safe-area-inset-bottom),env(safe-area-inset-left))] z-50 max-sm:inset-[max(1rem,env(safe-area-inset-top),env(safe-area-inset-right),env(safe-area-inset-bottom),env(safe-area-inset-left))]"
      ref={boundsRef}
    >
      {edge ? (
        <IconButtonTooltip label="Reveal Quieter">
          <motion.button
            aria-label="Reveal Quieter"
            data-assistant-edge-tab={edge}
            type="button"
            onPointerEnter={reveal}
            onPointerLeave={tuck}
            onFocus={reveal}
            onBlur={tuck}
            onClick={reveal}
            // oxlint-disable-next-line shadcn/no-inline-styles -- Edge tab tracks its normalized viewport position.
            style={{ x: tabX, y: tabY }}
            className={cn(
              "pointer-events-auto absolute right-0 bottom-0 z-10 flex items-center justify-center rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
              {
                "h-20 w-[18px]":
                  tucked && (edge === "left" || edge === "right"),
                "h-[18px] w-20":
                  tucked && (edge === "top" || edge === "bottom"),
                "pointer-events-none": open,
                "size-20": !tucked,
              }
            )}
          >
            <span
              className={cn(
                "absolute rounded-full bg-muted-fg/35 transition-colors hover:bg-fg/60",
                {
                  "bottom-2": edge === "bottom",
                  "h-0.5 w-7": edge === "top" || edge === "bottom",
                  "h-7 w-0.5": edge === "left" || edge === "right",
                  "left-2": edge === "left",
                  "right-2": edge === "right",
                  "top-2": edge === "top",
                }
              )}
            />
          </motion.button>
        </IconButtonTooltip>
      ) : null}
      <motion.div
        aria-hidden
        data-assistant-dock-marker
        // oxlint-disable-next-line shadcn/no-inline-styles -- Marker follows the measured sidebar slot.
        style={{ x: dockX, y: dockY }}
        animate={{
          opacity: dragging && hasDock ? 1 : 0,
          scale: nearDock ? 1.08 : 1,
        }}
        transition={{ duration: reducedMotion ? 0 : 0.15 }}
        className={cn(
          "absolute right-0 bottom-0 size-12 rounded-lg border border-dashed border-muted-fg/35 shadow-sm",
          {
            "border-fg/60 bg-control-active/60 shadow-elevation": nearDock,
          }
        )}
      >
        <span className="absolute -inset-1 rounded-xl border border-dashed border-muted-fg/15" />
      </motion.div>
      <motion.div
        data-assistant-surface
        data-assistant-edge-preview={pendingEdge ?? undefined}
        onPointerEnter={reveal}
        onPointerLeave={tuck}
        onFocusCapture={reveal}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            tuck();
          }
        }}
        // oxlint-disable-next-line shadcn/no-inline-styles -- Motion values keep dragging directly synchronized with the pointer.
        style={{ x, y }}
        initial={false}
        animate={{
          height: open ? panelSize.height : 48,
          opacity: tucked ? 0 : 1,
          width: open ? panelSize.width : 48,
        }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { bounce: 0.08, duration: 0.3, type: "spring" }
        }
        className={cn(
          "pointer-events-auto absolute right-0 bottom-0 z-20 max-h-full max-w-full overflow-hidden rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] text-fg shadow-elevation backdrop-blur-2xl",
          {
            "pointer-events-none": tucked,
            "ring-2 ring-muted-fg/30": pendingEdge !== null,
          }
        )}
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
            "absolute top-0 right-0 left-auto m-0 flex min-h-[min(20rem,calc(100dvh-3rem-2px))] w-[398px] max-w-[calc(100dvw-3rem-2px)] flex-col border-0 bg-transparent p-0 pt-4 text-fg max-sm:min-h-[min(20rem,calc(100dvh-2rem-2px))] max-sm:max-w-[calc(100dvw-2rem-2px)]",
            { "pointer-events-none": !open }
          )}
        >
          <header
            className="flex h-7 shrink-0 cursor-grab touch-none items-center gap-2 px-4 select-none active:cursor-grabbing"
            onPointerDown={startPanelDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
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
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </motion.dialog>
        <IconButtonTooltip label="Open Quieter">
          <motion.button
            aria-label="Open Quieter"
            aria-hidden={open || tucked}
            inert={open || tucked}
            tabIndex={open || tucked ? -1 : 0}
            initial={false}
            animate={{ opacity: open ? 0 : 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
            className={cn(
              "absolute right-0 bottom-0 flex size-[46px] cursor-grab touch-none items-center justify-center rounded-lg focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:cursor-grabbing",
              { "pointer-events-none": open }
            )}
            data-assistant-launcher
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
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
