"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { ArrowRight01Icon, Cancel01Icon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { LazyMotion, domAnimation, AnimatePresence, m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  normalizeLabelSelectionKey,
  type SearchFilterChip,
  type StructuredSearchState,
} from "~/features/message-search/state/message-list-search-state";
import { searchFilterOptions } from "./message-list-search-filter-options";

const createSearchFilterSections = (
  options: typeof searchFilterOptions,
): ReadonlyArray<{ label: string; options: typeof searchFilterOptions }> => [
  {
    label: "Status",
    options: options.filter((option) => option.filter.type === "is"),
  },
  {
    label: "Date",
    options: options.filter((option) =>
      ["after", "before", "newer_than", "older_than"].includes(option.filter.type),
    ),
  },
  {
    label: "People",
    options: options.filter((option) => ["bcc", "cc", "from", "to"].includes(option.filter.type)),
  },
  {
    label: "Content",
    options: options.filter((option) =>
      ["content", "filename", "has", "subject"].includes(option.filter.type),
    ),
  },
];

const isSearchFilterOptionActive = (
  filters: readonly SearchFilterChip[],
  optionFilter: SearchFilterChip,
) =>
  filters.some(
    (filter) =>
      filter.type === optionFilter.type &&
      (optionFilter.value.length === 0 || filter.value === optionFilter.value),
  );

const SearchDropdownSectionLabel = ({ children }: { children: string }) => (
  <p className="px-2.5 pb-1 text-xs text-muted-foreground">{children}</p>
);

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
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "flex h-8 max-h-8 min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-muted focus-visible:bg-muted",
      {
        "bg-muted": highlighted,
        "bg-accent": active,
      },
    )}
    onClick={onClick}
    type="button"
  >
    <HugeiconsIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" icon={icon} />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
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
  const [labelsLayout, setLabelsLayout] = useState<LabelsSubmenuLayout>(initialLabelsSubmenuLayout);
  const closeLabelsSubmenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelsInlineRef = useRef<HTMLDivElement>(null);
  const labelsSubmenuRef = useRef<HTMLDivElement>(null);
  const labelsTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedUserLabelKeys = new Set<string>();
  for (const filter of draftSearchState.filters) {
    if (filter.type === "label") {
      selectedUserLabelKeys.add(normalizeLabelSelectionKey(filter.value));
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
      Math.max(viewportGap, window.innerHeight - submenuHeight - viewportGap),
    );
    setLabelsLayout({
      coneHeight: submenuHeight,
      coneOriginY: triggerRect.top + triggerRect.height / 2 - top,
      left: Math.min(
        triggerRect.right + viewportGap,
        Math.max(viewportGap, window.innerWidth - submenuWidth - viewportGap),
      ),
      top,
    });
  }, [showLabelsSubmenu, isLoadingLabels, labelsErrorMessage, userLabels.length]);

  useLayoutEffect(() => {
    if (!showLabelsSubmenu || window.matchMedia("(min-width: 1024px)").matches) return;
    labelsInlineRef.current?.scrollIntoView({ block: "nearest" });
  }, [showLabelsSubmenu]);

  const labelsContent = labelsErrorMessage ? (
    <div className="px-2.5 py-2 text-[13px] text-foreground">{labelsErrorMessage}</div>
  ) : isLoadingLabels ? (
    <div className="px-2.5 py-2 text-[13px] text-muted-foreground">Loading labels…</div>
  ) : userLabels.length > 0 ? (
    <div className="flex flex-col gap-0.5">
      {userLabels.map((label) => (
        <SearchDropdownRow
          active={selectedUserLabelKeys.has(normalizeLabelSelectionKey(label.name))}
          highlighted={highlightedItemKey === `label:${normalizeLabelSelectionKey(label.name)}`}
          icon={Tag01Icon}
          key={label.id}
          label={label.name}
          onClick={() => onToggleLabel(label.name)}
        />
      ))}
    </div>
  ) : (
    <div className="px-2.5 py-2 text-[13px] text-muted-foreground">No custom labels.</div>
  );

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
              if (event.pointerType === "mouse") cancelCloseLabelsSubmenu();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") scheduleCloseLabelsSubmenu();
            }}
            points={`0 ${labelsLayout.coneOriginY} 8 0 8 ${labelsLayout.coneHeight}`}
          />
        </svg>
        <div
          aria-label="Labels"
          className="pointer-events-auto absolute top-0 left-2 max-h-[calc(100dvh-1rem)] w-72 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 shadow-lg"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") cancelCloseLabelsSubmenu();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") scheduleCloseLabelsSubmenu();
          }}
          ref={labelsSubmenuRef}
        >
          {labelsContent}
        </div>
      </div>,
      document.body,
    );

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {isOpen && (
          <m.div
            animate={{ scale: 1, transformOrigin: "top", opacity: 1, y: 0 }}
            exit={{
              scale: 0.95,
              transformOrigin: "top",
              opacity: 0,
              y: -10,
            }}
            initial={{ scale: 0.95, transformOrigin: "top", opacity: 0, y: -10 }}
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
                    <SearchDropdownSectionLabel>{section.label}</SearchDropdownSectionLabel>
                    {section.options.map((option) => (
                      <SearchDropdownRow
                        active={isSearchFilterOptionActive(draftSearchState.filters, option.filter)}
                        highlighted={
                          highlightedItemKey ===
                          `filter:${option.filter.type}:${option.filter.value}`
                        }
                        hint={option.hint}
                        icon={option.icon}
                        key={`${option.filter.type}:${option.filter.value}`}
                        label={option.label}
                        onClick={() => onSelectFilter(option.filter)}
                      />
                    ))}
                  </div>
                ))}

                <div className="flex flex-col gap-1">
                  <SearchDropdownSectionLabel>More</SearchDropdownSectionLabel>
                  <div
                    className="relative"
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "mouse") return;
                      cancelCloseLabelsSubmenu();
                      setIsLabelsSubmenuOpen(true);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType === "mouse") scheduleCloseLabelsSubmenu();
                    }}
                  >
                    <button
                      aria-expanded={showLabelsSubmenu}
                      aria-haspopup="true"
                      className={cn(
                        "relative z-50 flex h-8 max-h-8 min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-muted focus-visible:bg-muted",
                        {
                          "bg-muted": isLabelHighlighted,
                          "bg-accent": selectedUserLabelKeys.size > 0,
                        },
                      )}
                      onClick={() => {
                        setIsLabelsSubmenuOpen((open) => !open);
                      }}
                      ref={labelsTriggerRef}
                      type="button"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                        icon={Tag01Icon}
                      />
                      <span className="min-w-0 flex-1 truncate">Labels</span>
                      <HugeiconsIcon
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          {
                            "rotate-90 lg:rotate-0": showLabelsSubmenu,
                          },
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
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 active:bg-muted"
                onClick={onDismiss}
                type="button"
              >
                <HugeiconsIcon aria-hidden className="size-3.5" icon={Cancel01Icon} />
                Close search
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
