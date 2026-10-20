"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  Edit01Icon,
  LayoutRightIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  assistantLauncherSize,
  useAssistantPosition,
} from "@quieter/app/features/chat/components/use-assistant-position";
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
import { workspaceSectionVariants } from "@quieter/ui/workspace-section";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, SubmitEvent } from "react";

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
  sidebar?: boolean;
  narrow?: boolean;
  onToggleSidebar?: () => void;
  focusRequest?: number;
};

const getChatTitle = (chat: FloatingAssistantChat) =>
  chat.title?.trim() || "New chat";
const floatingSurfaceClassName =
  "overflow-hidden rounded-lg border border-border-strong/70 bg-bg-raised/90 [background-image:linear-gradient(160deg,color-mix(in_oklab,var(--bg-raised)_88%,transparent),color-mix(in_oklab,var(--bg)_96%,transparent))] text-fg shadow-elevation backdrop-blur-2xl";

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
  sidebar = false,
  narrow = false,
  onToggleSidebar,
  focusRequest,
}: FloatingAssistantProps) => {
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panelVisualRef = useRef<HTMLDivElement | null>(null);
  const launcherSurfaceRef = useRef<HTMLDivElement | null>(null);
  const layoutId = useId();
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const sidebarLauncherRef = useRef<HTMLButtonElement | null>(null);
  const focusInsideRef = useRef(false);
  useLayoutEffect(() => {
    if (sidebar && !open && focusInsideRef.current) {
      const focused = document.activeElement;
      if (
        focused === document.body ||
        (focused instanceof Element &&
          focused.closest("[data-assistant-panel]") !== null)
      ) {
        sidebarLauncherRef.current?.focus();
      }
      focusInsideRef.current = false;
    }
  }, [open, sidebar]);
  const reducedMotion = useReducedMotion() === true;
  const [panelSize, setPanelSize] = useState({
    height: assistantLauncherSize,
    width: 400,
  });
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
  } = useAssistantPosition({
    open: open && !sidebar,
    panelSize,
    reducedMotion,
  });
  const right = useMotionValue("0px");
  const bottom = useMotionValue("0px");
  useMotionValueEvent(x, "change", (value) => {
    right.set(`${-value}px`);
  });
  useMotionValueEvent(y, "change", (value) => {
    bottom.set(`${-value}px`);
  });
  const positionStyle = {
    "--assistant-bottom": bottom,
    "--assistant-right": right,
  };
  const prepareSurfaceMeasurement = (surface: HTMLDivElement | null) => {
    if (surface && !sidebar) {
      // Flush the latest position before Motion captures the shared layout box.
      surface.style.setProperty("--assistant-right", `${-x.get()}px`);
      surface.style.setProperty("--assistant-bottom", `${-y.get()}px`);
    }
  };
  useLayoutEffect((): (() => void) | undefined => {
    const panel = panelRef.current;
    if (!panel || sidebar) {
      return undefined;
    }
    let settledHeight = assistantLauncherSize;
    const measure = () => {
      const loading = panel.querySelector("[data-assistant-loading]") !== null;
      const measuredHeight = panel.offsetHeight + 2;
      const height = loading
        ? Math.max(settledHeight, measuredHeight)
        : measuredHeight;
      const width = panel.offsetWidth + 2;
      settledHeight = height;
      setPanelSize((previous) =>
        previous.height === height && previous.width === width
          ? previous
          : { height, width }
      );
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
      observer.disconnect();
      loadingObserver.disconnect();
    };
  }, [sidebar]);

  const previousOpenRef = useRef(open);
  const previousFocusRequestRef = useRef(focusRequest);
  const edgeDirection =
    pendingEdge === "left" || pendingEdge === "top" ? -1 : 1;
  const horizontalEdge = pendingEdge === "top" || pendingEdge === "bottom";
  const layoutDependency = `${sidebar}:${open}:${panelSize.width}:${panelSize.height}`;
  const edgeRotation =
    !sidebar && pendingEdge !== null && !reducedMotion
      ? [0, edgeDirection * 4, edgeDirection * -1.5, edgeDirection * 2]
      : 0;
  const surfaceTransition = {
    layout: {
      duration: reducedMotion ? 0 : 0.18,
      ease: [0.22, 1, 0.36, 1] as const,
    },
    opacity: { duration: reducedMotion ? 0 : 0.12 },
    rotate: { duration: reducedMotion ? 0 : 0.28, ease: "easeOut" as const },
  };
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
    const requested =
      focusRequest === undefined
        ? open && !previousOpenRef.current
        : focusRequest !== previousFocusRequestRef.current;
    previousOpenRef.current = open;
    previousFocusRequestRef.current = focusRequest;
    if (open && requested) {
      const animationFrame = window.requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLTextAreaElement>("[data-assistant-composer]")
          ?.focus();
      });
      return () => {
        window.cancelAnimationFrame(animationFrame);
      };
    }
    return undefined;
  }, [focusRequest, open]);

  const minimize = () => {
    onMinimize();
    window.requestAnimationFrame(() => {
      (sidebar ? sidebarLauncherRef.current : launcherRef.current)?.focus();
    });
  };

  return (
    <div
      className={cn("z-50", {
        "pointer-events-none fixed inset-[max(1.5rem,env(safe-area-inset-top),env(safe-area-inset-right),env(safe-area-inset-bottom),env(safe-area-inset-left))] [--assistant-safe-bottom:env(safe-area-inset-bottom,0px)] [--assistant-safe-left:env(safe-area-inset-left,0px)] [--assistant-safe-right:env(safe-area-inset-right,0px)] [--assistant-safe-top:env(safe-area-inset-top,0px)] max-sm:inset-[max(1rem,env(safe-area-inset-top),env(safe-area-inset-right),env(safe-area-inset-bottom),env(safe-area-inset-left))]":
          !sidebar,
        "relative flex min-h-0 shrink-0 flex-col p-1.5": sidebar,
        "w-12": sidebar && (!open || narrow),
        "w-[clamp(20rem,26vw,25rem)]": sidebar && open && !narrow,
      })}
      ref={boundsRef}
    >
      {sidebar && !open ? (
        <IconButtonTooltip label="Expand assistant sidebar">
          <Button
            aria-label="Expand assistant sidebar"
            data-assistant-launcher
            ref={sidebarLauncherRef}
            onClick={onOpen}
            size="icon"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden icon={LayoutRightIcon} />
          </Button>
        </IconButtonTooltip>
      ) : null}
      {!sidebar && edge ? (
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
                "h-[18px] w-[50px]":
                  tucked && (edge === "top" || edge === "bottom"),
                "h-[50px] w-[18px]":
                  tucked && (edge === "left" || edge === "right"),
                "pointer-events-none": open,
                "size-[50px]": !tucked,
              }
            )}
          />
        </IconButtonTooltip>
      ) : null}
      <motion.div
        aria-hidden
        data-assistant-dock-marker
        // oxlint-disable-next-line shadcn/no-inline-styles -- Marker follows the measured sidebar slot.
        style={{ x: dockX, y: dockY }}
        animate={{
          opacity: !sidebar && dragging && hasDock ? 1 : 0,
          scale: nearDock ? 1.08 : 1,
        }}
        transition={{ duration: reducedMotion ? 0 : 0.15 }}
        className={cn(
          "absolute right-0 bottom-0 size-[50px] rounded-lg border border-dashed border-muted-fg/35 shadow-sm",
          {
            "border-fg/60 bg-control-active/60 shadow-elevation": nearDock,
            hidden: sidebar,
          }
        )}
      >
        <span className="absolute -inset-1 rounded-xl border border-dashed border-muted-fg/15" />
      </motion.div>
      {!sidebar && pendingEdge !== null && !reducedMotion ? (
        <motion.div
          aria-hidden
          data-assistant-edge-wind
          className="pointer-events-none absolute right-0 bottom-0 z-20 size-[50px]"
          // oxlint-disable-next-line shadcn/no-inline-styles -- Wind feedback follows the dragged launcher.
          style={{ x, y }}
        >
          {[0, 1, 2].map((particle) => (
            <motion.span
              key={particle}
              className={cn("absolute rounded-full bg-muted-fg/45", {
                "bottom-full": pendingEdge === "bottom",
                "h-1.5 w-px": horizontalEdge,
                "h-px w-1.5": !horizontalEdge,
                "left-10": horizontalEdge && particle === 2,
                "left-2": horizontalEdge && particle === 0,
                "left-6": horizontalEdge && particle === 1,
                "left-full": pendingEdge === "left",
                "right-full": pendingEdge === "right",
                "top-10": !horizontalEdge && particle === 2,
                "top-2": !horizontalEdge && particle === 0,
                "top-6": !horizontalEdge && particle === 1,
                "top-full": pendingEdge === "top",
              })}
              initial={{ opacity: 0 }}
              animate={{
                opacity: [0, 0.4, 0],
                x: horizontalEdge ? 0 : [0, edgeDirection * 10],
                y: horizontalEdge ? [0, edgeDirection * 10] : 0,
              }}
              transition={{
                delay: particle * 0.05,
                duration: 0.35,
                ease: "easeOut",
                repeat: 1,
                repeatDelay: 0.2,
              }}
            />
          ))}
        </motion.div>
      ) : null}
      <AnimatePresence>
        {open ? (
          <motion.div
            key={sidebar ? "sidebar-surface" : "panel-surface"}
            aria-hidden
            data-assistant-visual="panel"
            layout
            layoutId={layoutId}
            layoutDependency={layoutDependency}
            ref={panelVisualRef}
            onBeforeLayoutMeasure={() => {
              prepareSurfaceMeasurement(panelVisualRef.current);
            }}
            // oxlint-disable shadcn/no-inline-styles -- Shared layout projects the panel surface between its actual viewport boxes.
            style={{
              ...positionStyle,
              borderRadius: sidebar ? "var(--radius-xl)" : 14,
              height: sidebar ? "100%" : panelSize.height,
              width: sidebar ? "100%" : panelSize.width,
            }}
            // oxlint-enable shadcn/no-inline-styles
            exit={{ opacity: 0 }}
            transition={surfaceTransition}
            className={cn(
              "pointer-events-none absolute z-10 max-h-full max-w-full",
              {
                [workspaceSectionVariants({ layout: "surface" })]: sidebar,
                [floatingSurfaceClassName]: !sidebar,
                "fixed inset-y-[max(1rem,env(safe-area-inset-top),env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] h-auto! w-[min(25rem,calc(100dvw-2*max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))))]! max-w-none":
                  sidebar && narrow,
                "inset-1.5 h-auto! w-auto!": sidebar && !narrow,
                "right-[var(--assistant-right)] bottom-[var(--assistant-bottom)]":
                  !sidebar,
              }
            )}
          />
        ) : null}
        <motion.div
          key="content"
          data-assistant-surface
          layout={!sidebar && !dragging && !reducedMotion}
          layoutDependency={layoutDependency}
          ref={surfaceRef}
          onBeforeLayoutMeasure={() => {
            prepareSurfaceMeasurement(surfaceRef.current);
          }}
          data-assistant-edge-preview={pendingEdge ?? undefined}
          onPointerEnter={reveal}
          onPointerLeave={tuck}
          onFocusCapture={() => {
            focusInsideRef.current = true;
            reveal();
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              if (
                event.relatedTarget !== null &&
                !(
                  event.relatedTarget instanceof Element &&
                  event.relatedTarget.closest("[data-assistant-panel]") !== null
                )
              ) {
                focusInsideRef.current = false;
              }
              tuck();
            }
          }}
          // oxlint-disable shadcn/no-inline-styles -- Layout animation morphs the measured size while motion values handle dragging.
          style={{
            ...positionStyle,
            height: sidebar ? "100%" : panelSize.height,
            width: sidebar ? "100%" : panelSize.width,
          }}
          // oxlint-enable shadcn/no-inline-styles
          animate={{
            opacity: open ? 1 : 0,
          }}
          transition={{
            ...surfaceTransition,
            opacity: {
              delay: open && !reducedMotion ? 0.06 : 0,
              duration: reducedMotion ? 0 : 0.12,
            },
          }}
          className={cn(
            "pointer-events-auto absolute z-20 max-h-full max-w-full overflow-hidden rounded-lg border border-transparent text-fg",
            {
              "fixed inset-y-[max(1rem,env(safe-area-inset-top),env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] h-auto! w-[min(25rem,calc(100dvw-2*max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))))]! max-w-none":
                sidebar && narrow,
              hidden: sidebar && !open,
              "pointer-events-none": !open,
              "relative right-auto bottom-auto": sidebar && !narrow,
              "right-[var(--assistant-right)] bottom-[var(--assistant-bottom)]":
                !sidebar,
              "rounded-xl": sidebar,
            }
          )}
        >
          <motion.dialog
            layout="position"
            transition={{
              layout: {
                duration: reducedMotion ? 0 : 0.18,
                ease: [0.22, 1, 0.36, 1],
              },
              opacity: { duration: reducedMotion ? 0 : 0.12 },
            }}
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
            className={cn(
              "absolute top-0 right-0 left-auto m-0 flex min-h-[min(15rem,calc(100dvh-3rem-2px))] w-[398px] max-w-[calc(100dvw-3rem-2px)] flex-col border-0 bg-transparent p-0 pt-4 text-fg max-sm:min-h-[min(15rem,calc(100dvh-2rem-2px))] max-sm:max-w-[calc(100dvw-2rem-2px)]",
              { "pointer-events-none": !open },
              {
                "relative top-auto right-auto h-full min-h-0 w-full max-w-none max-sm:min-h-0 max-sm:max-w-none":
                  sidebar,
              }
            )}
          >
            <header className="flex h-9 shrink-0 items-center gap-2 px-4">
              {sidebar ? null : (
                <IconButtonTooltip label="Move assistant">
                  <Button
                    aria-label="Move assistant"
                    data-assistant-drag-handle
                    // oxlint-disable-next-line shadcn/no-restyle -- Dedicated grip keeps drag gestures away from conversation controls.
                    className="touch-none active:cursor-grabbing"
                    size="icon"
                    variant="ghost"
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={endDrag}
                  >
                    <HugeiconsIcon aria-hidden icon={DragDropVerticalIcon} />
                  </Button>
                </IconButtonTooltip>
              )}
              <DropdownMenu key={open ? "visible" : "hidden"}>
                <DropdownMenuTrigger
                  appearance="row-strong"
                  aria-label="Open conversation history"
                  type="button"
                >
                  <span className="max-w-40 truncate">
                    {activeChat ? getChatTitle(activeChat) : "New chat"}
                  </span>
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
                {onToggleSidebar ? (
                  <IconButtonTooltip
                    label={
                      sidebar
                        ? "Use floating assistant"
                        : "Use assistant sidebar"
                    }
                  >
                    <Button
                      aria-label={
                        sidebar
                          ? "Use floating assistant"
                          : "Use assistant sidebar"
                      }
                      aria-pressed={sidebar}
                      onClick={onToggleSidebar}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        icon={sidebar ? DragDropVerticalIcon : LayoutRightIcon}
                      />
                    </Button>
                  </IconButtonTooltip>
                ) : null}
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
        </motion.div>
        {!sidebar && !open ? (
          <motion.div
            key="launcher"
            layout={!dragging && !reducedMotion}
            layoutId={layoutId}
            layoutDependency={layoutDependency}
            ref={launcherSurfaceRef}
            onBeforeLayoutMeasure={() => {
              prepareSurfaceMeasurement(launcherSurfaceRef.current);
            }}
            data-assistant-surface
            data-assistant-visual="launcher"
            data-assistant-edge-preview={pendingEdge ?? undefined}
            onPointerEnter={reveal}
            onPointerLeave={tuck}
            // oxlint-disable shadcn/no-inline-styles -- Shared layout animation keeps the launcher radius and viewport position consistent.
            style={{
              ...positionStyle,
              borderRadius: 14,
            }}
            // oxlint-enable shadcn/no-inline-styles
            animate={{ rotate: edgeRotation }}
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={surfaceTransition}
            className={cn(
              "pointer-events-auto absolute right-[var(--assistant-right)] bottom-[var(--assistant-bottom)] z-20 size-[50px]",
              floatingSurfaceClassName,
              {
                "border-muted-fg/70": pendingEdge !== null && reducedMotion,
                "pointer-events-none": tucked,
              }
            )}
          >
            <IconButtonTooltip label="Open Quieter">
              <motion.button
                aria-label="Open Quieter"
                aria-hidden={tucked}
                inert={tucked}
                tabIndex={tucked ? -1 : 0}
                layout="position"
                initial={false}
                transition={surfaceTransition}
                className="absolute right-0 bottom-0 flex size-12 touch-none items-center justify-center rounded-lg focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:cursor-grabbing"
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
                <Brand className="pointer-events-none size-6" />
              </motion.button>
            </IconButtonTooltip>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
