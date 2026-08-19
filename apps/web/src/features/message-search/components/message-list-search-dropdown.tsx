"use client";

import {
  ArrowRight01Icon,
  Cancel01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { cn } from "@quieter/ui/cn";
import { LazyMotion, domAnimation, AnimatePresence, m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { mailboxLabelSearchPillSurfaceClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import { normalizeLabelSelectionKey } from "#/features/message-search/state/message-list-search-state";
import type {
  SearchFilterChip,
  StructuredSearchState,
} from "#/features/message-search/state/message-list-search-state";

import type { searchFilterOptions } from "./message-list-search-filter-options";

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

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

const SearchDropdownSectionLabel = ({ children }: { children: string }) => (
  <p className="px-2.5 pb-1 text-caption text-muted-fg">{children}</p>
);

const SearchDropdownRow = ({
  active = false,
  className,
  highlighted = false,
  hint,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  className?: string;
  highlighted?: boolean;
  hint?: string;
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "relative flex h-8 max-h-8 min-h-8 w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left text-body-sm text-fg hover:bg-muted focus-visible:z-10 focus-visible:border-ring focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none",
      className,
      {
        "bg-accent": active && !hasText(className),
        "bg-muted": highlighted && !hasText(className),
        "ring-1 ring-ring/45 ring-inset":
          active && !highlighted && hasText(className),
        "ring-2 ring-ring/60 ring-inset": highlighted && hasText(className),
      }
    )}
    onClick={onClick}
    type="button"
  >
    <HugeiconsIcon
      aria-hidden
      className="size-3.5 shrink-0 text-muted-fg"
      icon={icon}
    />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {hasText(hint) && <span className="text-micro text-muted-fg">{hint}</span>}
  </button>
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

  useLayoutEffect(() => {
    if (!showLabelsSubmenu) {
      return;
    }

    const submenu = labelsSubmenuRef.current;
    const trigger = labelsTriggerRef.current;
    if (!submenu || !trigger) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const submenuWidth = submenu.offsetWidth;
    const submenuHeight = submenu.offsetHeight;
    const viewportGap = 8;
    const top = Math.min(
      triggerRect.top,
      Math.max(viewportGap, window.innerHeight - submenuHeight - viewportGap)
    );
    setLabelsLayout({
      coneHeight: submenuHeight,
      coneOriginY: triggerRect.top + triggerRect.height / 2 - top,
      left: Math.min(
        triggerRect.right + viewportGap,
        Math.max(viewportGap, window.innerWidth - submenuWidth - viewportGap)
      ),
      top,
    });
  }, [
    showLabelsSubmenu,
    isLoadingLabels,
    labelsErrorMessage,
    userLabels.length,
  ]);

  useLayoutEffect(() => {
    if (
      !showLabelsSubmenu ||
      window.matchMedia("(min-width: 1024px)").matches
    ) {
      return;
    }
    labelsInlineRef.current?.scrollIntoView({ block: "nearest" });
  }, [showLabelsSubmenu]);

  let labelsContent: ReactNode;
  if (hasText(labelsErrorMessage)) {
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
          const selectionState = selectedUserLabelStates.get(
            normalizeLabelSelectionKey(label.name)
          );
          return (
            <SearchDropdownRow
              active={selectionState !== undefined}
              className={
                mailboxLabelSearchPillSurfaceClassNameByColor[
                  label.color ?? "gray"
                ]
              }
              highlighted={
                highlightedItemKey ===
                `label:${normalizeLabelSelectionKey(label.name)}`
              }
              icon={Tag01Icon}
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
          height: labelsLayout.coneHeight,
          left: labelsLayout.left - 8,
          top: labelsLayout.top,
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
        <div
          aria-label="Labels"
          className="pointer-events-auto absolute top-0 left-2 max-h-[calc(100dvh-1rem)] w-72 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 shadow-lg"
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
        </div>
      </div>,
      document.body
    );

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {isOpen && (
          <m.div
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
            className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-30 flex max-h-56 flex-col overflow-hidden rounded-lg bg-popover p-2 shadow-lg lg:absolute lg:inset-x-0 lg:top-full lg:mt-2 lg:max-h-72"
            data-search-dropdown-content
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
              <div className="flex flex-col gap-3">
                {searchFilterSections.map((section) => (
                  <div className="flex flex-col gap-1" key={section.label}>
                    <SearchDropdownSectionLabel>
                      {section.label}
                    </SearchDropdownSectionLabel>
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
                          icon={option.icon}
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
                  <SearchDropdownSectionLabel>More</SearchDropdownSectionLabel>
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
                    <button
                      aria-expanded={showLabelsSubmenu}
                      aria-haspopup="true"
                      className={cn(
                        "relative z-50 flex h-8 max-h-8 min-h-8 w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left text-body-sm text-fg hover:bg-muted focus-visible:border-ring focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none",
                        {
                          "bg-accent": selectedUserLabelStates.size > 0,
                          "bg-muted": isLabelHighlighted,
                        }
                      )}
                      onClick={() => {
                        setIsLabelsSubmenuOpen((open) => !open);
                      }}
                      ref={labelsTriggerRef}
                      type="button"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-fg"
                        icon={Tag01Icon}
                      />
                      <span className="min-w-0 flex-1 truncate">Labels</span>
                      <HugeiconsIcon
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 text-muted-fg transition-transform",
                          {
                            "rotate-90 lg:rotate-0": showLabelsSubmenu,
                          }
                        )}
                        icon={ArrowRight01Icon}
                      />
                    </button>

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
                            <div
                              aria-label="Labels"
                              className="mt-1 rounded-md bg-muted/35 p-1"
                              ref={labelsInlineRef}
                            >
                              {labelsContent}
                            </div>
                          </div>
                        </m.div>
                      )}
                    </AnimatePresence>
                    {labelsSubmenu}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-1 shrink-0 lg:hidden">
              <button
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md text-caption text-muted-fg hover:bg-muted hover:text-fg active:bg-muted"
                onClick={onDismiss}
                type="button"
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5"
                  icon={Cancel01Icon}
                />
                Close search
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
