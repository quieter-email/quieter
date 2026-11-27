"use client";

import {
  ArrowRight01Icon,
  Cancel01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { MailboxLabelSwatch } from "@quieter/app/features/message-labels/components/mailbox-label-swatch";
import type { searchFilterOptions } from "@quieter/app/features/message-search/components/message-list-search-filter-options";
import { normalizeLabelSelectionKey } from "@quieter/app/features/message-search/state/message-list-search-state";
import type {
  SearchFilterChip,
  StructuredSearchState,
} from "@quieter/app/features/message-search/state/message-list-search-state";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import {
  PopupMenuButton,
  PopupMenuGroupLabel,
  PopupMenuSurface,
} from "@quieter/ui/popup-menu";
import { LazyMotion, domAnimation, AnimatePresence, m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const createSearchFilterSections = (
  options: typeof searchFilterOptions
): readonly { label: string; options: typeof searchFilterOptions }[] => [
  {
    label: "Status",
    options: options.filter((option) => option.filter.type === "is"),
  },
  {
    label: "Date",
    options: options.filter((option) =>
      ["after", "before", "newer_than", "older_than"].includes(
        option.filter.type
      )
    ),
  },
  {
    label: "People",
    options: options.filter((option) =>
      ["bcc", "cc", "from", "to"].includes(option.filter.type)
    ),
  },
  {
    label: "Content",
    options: options.filter((option) =>
      ["content", "filename", "has", "subject"].includes(option.filter.type)
    ),
  },
];

const getSearchFilterOptionState = (
  filters: readonly SearchFilterChip[],
  optionFilter: SearchFilterChip
) => {
  const filter = filters.find(
    (candidateFilter) =>
      candidateFilter.type === optionFilter.type &&
      (optionFilter.value.length === 0 ||
        candidateFilter.value === optionFilter.value)
  );
  if (filter === undefined) {
    return null;
  }
  return filter.negated === true ? "exclude" : "include";
};

const MotionPopupMenuSurface = m.create(PopupMenuSurface);

const SearchDropdownRow = ({
  active = false,
  highlighted = false,
  hint,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  highlighted?: boolean;
  hint?: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <PopupMenuButton
    aria-pressed={active}
    data-search-highlighted={highlighted || undefined}
    highlighted={highlighted}
    onClick={onClick}
  >
    {icon}
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {!!hint && <span className="text-micro text-muted-fg">{hint}</span>}
  </PopupMenuButton>
);

type LabelsSubmenuLayout = {
  coneHeight: number;
  coneOriginY: number;
  left: number;
  top: number;
};

const initialLabelsSubmenuLayout: LabelsSubmenuLayout = {
  coneHeight: 224,
  coneOriginY: 16,
  left: 0,
  top: 0,
};

export const MessageListSearchDropdown = ({
  draftSearchState,
  filterOptions,
  highlightedItemKey,
  isOpen,
  isLoadingLabels,
  labelsErrorMessage,
  onDismiss,
  onSelectFilter,
  onToggleLabel,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  filterOptions: typeof searchFilterOptions;
  highlightedItemKey: string | null;
  isOpen: boolean;
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
  onDismiss: () => void;
  onSelectFilter: (filter: SearchFilterChip) => void;
  onToggleLabel: (labelName: string) => void;
  userLabels: readonly MailboxLabel[];
}) => {
  const searchFilterSections = createSearchFilterSections(filterOptions);
  const [isLabelsSubmenuOpen, setIsLabelsSubmenuOpen] = useState(false);
  const [labelsLayout, setLabelsLayout] = useState<LabelsSubmenuLayout>(
    initialLabelsSubmenuLayout
  );
  const closeLabelsSubmenuTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const labelsInlineRef = useRef<HTMLDivElement>(null);
  const labelsSubmenuRef = useRef<HTMLDivElement>(null);
  const labelsTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedUserLabelStates = new Map<string, "exclude" | "include">();
  for (const filter of draftSearchState.filters) {
    if (filter.type === "label") {
      selectedUserLabelStates.set(
        normalizeLabelSelectionKey(filter.value),
        filter.negated === true ? "exclude" : "include"
      );
    }
  }
  const isLabelHighlighted = highlightedItemKey?.startsWith("label:") ?? false;
  const showLabelsSubmenu = isLabelsSubmenuOpen || isLabelHighlighted;

  const closeLabelsSubmenu = () => {
    setIsLabelsSubmenuOpen(false);
  };

  const cancelCloseLabelsSubmenu = () => {
    if (!closeLabelsSubmenuTimeoutRef.current) {
      return;
    }

    clearTimeout(closeLabelsSubmenuTimeoutRef.current);
    closeLabelsSubmenuTimeoutRef.current = null;
  };

  const scheduleCloseLabelsSubmenu = () => {
    cancelCloseLabelsSubmenu();
    closeLabelsSubmenuTimeoutRef.current = setTimeout(() => {
      closeLabelsSubmenu();
      closeLabelsSubmenuTimeoutRef.current = null;
    }, 80);
  };

  useEffect(() => cancelCloseLabelsSubmenu, []);

  useLayoutEffect((): (() => void) | undefined => {
    if (!isOpen) {
      return undefined;
    }

    const container = scrollContainerRef.current;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    const revealHighlightedRow = () => {
      const highlightedRow = container?.querySelector<HTMLElement>(
        "[data-search-highlighted]"
      );
      const target =
        isDesktop &&
        (isLabelHighlighted || (showLabelsSubmenu && !highlightedItemKey))
          ? labelsTriggerRef.current
          : (highlightedRow ??
            (!isDesktop && showLabelsSubmenu
              ? (labelsInlineRef.current?.querySelector<HTMLElement>(
                  "button"
                ) ?? labelsInlineRef.current)
              : null));
      if (container && target) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.top < containerRect.top) {
          container.scrollTop += targetRect.top - containerRect.top;
        } else if (targetRect.bottom > containerRect.bottom) {
          container.scrollTop += targetRect.bottom - containerRect.bottom;
        }
      }
    };
    revealHighlightedRow();

    if (isLabelHighlighted && isDesktop) {
      const submenu = labelsSubmenuRef.current;
      const row = submenu?.querySelector<HTMLElement>(
        "[data-search-highlighted]"
      );
      if (submenu && row) {
        const submenuRect = submenu.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        if (rowRect.top < submenuRect.top) {
          submenu.scrollTop += rowRect.top - submenuRect.top;
        } else if (rowRect.bottom > submenuRect.bottom) {
          submenu.scrollTop += rowRect.bottom - submenuRect.bottom;
        }
      }
    }
    const inlineViewport = labelsInlineRef.current?.parentElement;
    if (!isDesktop && inlineViewport) {
      const observer = new ResizeObserver(revealHighlightedRow);
      observer.observe(inlineViewport);
      return () => {
        observer.disconnect();
      };
    }
    return undefined;
  }, [highlightedItemKey, isLabelHighlighted, isOpen, showLabelsSubmenu]);

  useLayoutEffect((): (() => void) | undefined => {
    if (!isOpen || !showLabelsSubmenu) {
      return undefined;
    }

    const submenu = labelsSubmenuRef.current;
    const trigger = labelsTriggerRef.current;
    if (!submenu || !trigger) {
      return undefined;
    }

    const updateLayout = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        return;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const submenuWidth = submenu.offsetWidth;
      const submenuHeight = submenu.offsetHeight;
      const viewportGap = 8;
      const top = Math.max(
        viewportGap,
        Math.min(
          triggerRect.top,
          window.innerHeight - submenuHeight - viewportGap
        )
      );
      setLabelsLayout({
        coneHeight: submenuHeight,
        coneOriginY: Math.max(
          0,
          Math.min(
            submenuHeight,
            triggerRect.top + triggerRect.height / 2 - top
          )
        ),
        left: Math.max(
          viewportGap,
          Math.min(
            triggerRect.right + viewportGap,
            window.innerWidth - submenuWidth - viewportGap
          )
        ),
        top,
      });
    };
    updateLayout();
    window.addEventListener("scroll", updateLayout, true);
    window.addEventListener("resize", updateLayout);
    const observer = new ResizeObserver(updateLayout);
    observer.observe(submenu);
    return () => {
      window.removeEventListener("scroll", updateLayout, true);
      window.removeEventListener("resize", updateLayout);
      observer.disconnect();
    };
  }, [isOpen, showLabelsSubmenu, highlightedItemKey]);

  let labelsContent: ReactNode;
  if (labelsErrorMessage) {
    labelsContent = (
      <div className="px-2.5 py-2 text-body-sm text-fg">
        {labelsErrorMessage}
      </div>
    );
  } else if (isLoadingLabels) {
    labelsContent = (
      <div className="px-2.5 py-2 text-body-sm text-muted-fg">
        Loading labels…
      </div>
    );
  } else if (userLabels.length > 0) {
    labelsContent = (
      <div className="flex flex-col gap-0.5">
        {userLabels.map((label) => {
          const selectionState =
            selectedUserLabelStates.get(normalizeLabelSelectionKey(label.id)) ??
            selectedUserLabelStates.get(normalizeLabelSelectionKey(label.name));
          return (
            <SearchDropdownRow
              active={selectionState !== undefined}
              highlighted={
                highlightedItemKey ===
                `label:${normalizeLabelSelectionKey(label.name)}`
              }
              icon={<MailboxLabelSwatch color={label.color} />}
              key={label.id}
              label={
                selectionState === "exclude" ? `Not ${label.name}` : label.name
              }
              onClick={() => {
                onToggleLabel(label.name);
              }}
            />
          );
        })}
      </div>
    );
  } else {
    labelsContent = (
      <div className="px-2.5 py-2 text-body-sm text-muted-fg">
        No custom labels.
      </div>
    );
  }

  const labelsSubmenu =
    showLabelsSubmenu &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="pointer-events-none fixed z-50 hidden lg:block"
        data-search-dropdown-content
        style={{
          // oxlint-disable-next-line shadcn/no-inline-styles -- Dropdown rect is measured from the anchor element.
          height: labelsLayout.coneHeight,
          // oxlint-disable-next-line shadcn/no-inline-styles -- Dropdown rect is measured from the anchor element.
          left: labelsLayout.left - 8,
          // oxlint-disable-next-line shadcn/no-inline-styles -- Dropdown rect is measured from the anchor element.
          top: labelsLayout.top,
          // oxlint-disable-next-line shadcn/no-inline-styles -- Dropdown rect is measured from the anchor element.
          width: 296,
        }}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0"
          height={labelsLayout.coneHeight}
          viewBox={`0 0 8 ${labelsLayout.coneHeight}`}
          width="8"
        >
          <polygon
            className="pointer-events-auto"
            fill="transparent"
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") {
                cancelCloseLabelsSubmenu();
              }
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") {
                scheduleCloseLabelsSubmenu();
              }
            }}
            points={`0 ${labelsLayout.coneOriginY} 8 0 8 ${labelsLayout.coneHeight}`}
          />
        </svg>
        <PopupMenuSurface
          aria-label="Labels"
          className="pointer-events-auto absolute top-0 left-2 max-h-[calc(100dvh-1rem)] w-72 overflow-x-hidden overflow-y-auto overscroll-contain"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              cancelCloseLabelsSubmenu();
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") {
              scheduleCloseLabelsSubmenu();
            }
          }}
          ref={labelsSubmenuRef}
        >
          {labelsContent}
        </PopupMenuSurface>
      </div>,
      document.body
    );

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {isOpen && (
          <MotionPopupMenuSurface
            animate={{ opacity: 1, scale: 1, transformOrigin: "top", y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.95,
              transformOrigin: "top",
              y: -10,
            }}
            initial={{
              opacity: 0,
              scale: 0.95,
              transformOrigin: "top",
              y: -10,
            }}
            transition={{ duration: 0.1, ease: "easeOut" }}
            aria-label="Search filters"
            className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-30 flex max-h-[min(22rem,calc(100dvh-6rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] flex-col overflow-hidden lg:absolute lg:inset-x-0 lg:top-full lg:mt-2 lg:max-h-[min(28rem,calc(100dvh-6rem))]"
            data-blocking-overlay=""
            data-search-dropdown-content
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            <div
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
              ref={scrollContainerRef}
            >
              <div className="flex flex-col gap-2.5">
                {searchFilterSections.map((section) => (
                  <div className="flex flex-col gap-0.5" key={section.label}>
                    <PopupMenuGroupLabel>{section.label}</PopupMenuGroupLabel>
                    {section.options.map((option) => {
                      const selectionState = getSearchFilterOptionState(
                        draftSearchState.filters,
                        option.filter
                      );
                      return (
                        <SearchDropdownRow
                          active={selectionState !== null}
                          highlighted={
                            highlightedItemKey ===
                            `filter:${option.filter.type}:${option.filter.value}`
                          }
                          hint={
                            selectionState === "exclude"
                              ? `-${option.hint}`
                              : option.hint
                          }
                          icon={
                            <Icon
                              aria-hidden
                              icon={option.icon}
                              size={14}
                              tone="muted"
                            />
                          }
                          key={`${option.filter.type}:${option.filter.value}`}
                          label={
                            selectionState === "exclude"
                              ? `Not ${option.label}`
                              : option.label
                          }
                          onClick={() => {
                            onSelectFilter(option.filter);
                          }}
                        />
                      );
                    })}
                  </div>
                ))}

                <div className="flex flex-col gap-1">
                  <PopupMenuGroupLabel>More</PopupMenuGroupLabel>
                  <div
                    className="relative"
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "mouse") {
                        return;
                      }
                      cancelCloseLabelsSubmenu();
                      setIsLabelsSubmenuOpen(true);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType === "mouse") {
                        scheduleCloseLabelsSubmenu();
                      }
                    }}
                  >
                    <PopupMenuButton
                      aria-expanded={showLabelsSubmenu}
                      aria-haspopup="true"
                      aria-pressed={selectedUserLabelStates.size > 0}
                      className="z-50"
                      highlighted={isLabelHighlighted || showLabelsSubmenu}
                      onClick={() => {
                        setIsLabelsSubmenuOpen((open) => !open);
                      }}
                      ref={labelsTriggerRef}
                    >
                      <Icon
                        aria-hidden
                        size={14}
                        tone="muted"

                        icon={Tag01Icon}
                      />
                      <span className="min-w-0 flex-1 truncate">Labels</span>
                      <Icon
                        aria-hidden
                        className={cn("", {
                          "rotate-90 lg:rotate-0": showLabelsSubmenu,
                        })}
                        size={14}
                        tone="muted"
                        icon={ArrowRight01Icon}
                      />
                    </PopupMenuButton>

                    <AnimatePresence initial={false}>
                      {showLabelsSubmenu && (
                        <m.div
                          animate={{ gridTemplateRows: "1fr", opacity: 1 }}
                          className="grid lg:hidden"
                          exit={{ gridTemplateRows: "0fr", opacity: 0 }}
                          initial={{ gridTemplateRows: "0fr", opacity: 0 }}
                          transition={{ duration: 0.16, ease: "easeOut" }}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <PopupMenuSurface
                              aria-label="Labels"
                              className="mt-1"
                              ref={labelsInlineRef}
                            >
                              {labelsContent}
                            </PopupMenuSurface>
                          </div>
                        </m.div>
                      )}
                    </AnimatePresence>
                    {labelsSubmenu}
                  </div>
                </div>
              </div>
            </div>

            <ActionFooter className="mt-1 shrink-0 lg:hidden">
              <Button onClick={onDismiss} size="sm" type="button">
                <Icon aria-hidden size={14} icon={Cancel01Icon} />
                Close search
              </Button>
            </ActionFooter>
          </MotionPopupMenuSurface>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
