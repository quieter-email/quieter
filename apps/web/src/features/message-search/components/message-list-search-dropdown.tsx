"use client";

import { ArrowRight01Icon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { LazyMotion, domAnimation, AnimatePresence, m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";
import {
  normalizeLabelSelectionKey,
  type SearchFilterChip,
  type StructuredSearchState,
} from "~/features/message-search/state/message-list-search-state";
import { searchFilterOptions } from "./message-list-search-filter-options";

const searchFilterSections: ReadonlyArray<{
  label: string;
  options: typeof searchFilterOptions;
}> = [
  {
    label: "Status",
    options: searchFilterOptions.filter((option) => option.filter.type === "is"),
  },
  {
    label: "Date",
    options: searchFilterOptions.filter((option) =>
      ["after", "before", "newer_than", "older_than"].includes(option.filter.type),
    ),
  },
  {
    label: "People",
    options: searchFilterOptions.filter((option) =>
      ["bcc", "cc", "from", "to"].includes(option.filter.type),
    ),
  },
  {
    label: "Content",
    options: searchFilterOptions.filter((option) =>
      ["filename", "has"].includes(option.filter.type),
    ),
  },
];

if (import.meta.env.MODE !== "production") {
  const sectionOptionCounts = new Map<string, number>();
  for (const section of searchFilterSections) {
    for (const option of section.options) {
      const key = `${option.filter.type}:${option.filter.value}`;
      sectionOptionCounts.set(key, (sectionOptionCounts.get(key) ?? 0) + 1);
    }
  }

  const missingOptions: string[] = [];
  for (const option of searchFilterOptions) {
    const key = `${option.filter.type}:${option.filter.value}`;
    if (!sectionOptionCounts.has(key)) {
      missingOptions.push(key);
    }
  }

  const duplicatedOptions: string[] = [];
  for (const [key, count] of sectionOptionCounts) {
    if (count > 1) {
      duplicatedOptions.push(key);
    }
  }

  if (missingOptions.length > 0 || duplicatedOptions.length > 0) {
    throw new Error(
      `searchFilterSections must include each searchFilterOptions entry exactly once. Missing: ${
        missingOptions.join(", ") || "none"
      }. Duplicated: ${duplicatedOptions.join(", ") || "none"}.`,
    );
  }
}

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
        "bg-muted/80 ring-1 ring-border ring-inset": active,
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
  coneWidth: number;
  coneOriginY: number;
  height: number;
  left: number;
  top: number;
  triggerHeight: number;
};

const initialLabelsSubmenuLayout: LabelsSubmenuLayout = {
  coneWidth: 320,
  coneOriginY: 32,
  height: 224,
  left: 0,
  top: 0,
  triggerHeight: 32,
};

export const MessageListSearchDropdown = ({
  draftSearchState,
  highlightedItemKey,
  isOpen,
  isLoadingLabels,
  labelsErrorMessage,
  onSelectFilter,
  onToggleLabel,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  highlightedItemKey: string | null;
  isOpen: boolean;
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
  onSelectFilter: (filter: SearchFilterChip) => void;
  onToggleLabel: (labelName: string) => void;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const [isLabelsSubmenuOpen, setIsLabelsSubmenuOpen] = useState(false);
  const [labelsLayout, setLabelsLayout] = useState<LabelsSubmenuLayout>(initialLabelsSubmenuLayout);
  const closeLabelsSubmenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setLabelsLayout({
      coneWidth: trigger.offsetWidth + 8,
      coneOriginY: trigger.offsetHeight,
      height: submenu.offsetHeight,
      left: Math.min(
        triggerRect.right + viewportGap,
        Math.max(viewportGap, window.innerWidth - submenuWidth - viewportGap),
      ),
      top: Math.min(
        triggerRect.top,
        Math.max(viewportGap, window.innerHeight - submenuHeight - viewportGap),
      ),
      triggerHeight: triggerRect.height,
    });
  }, [showLabelsSubmenu, isLoadingLabels, labelsErrorMessage, userLabels.length]);

  const labelsContent = labelsErrorMessage ? (
    <div className="px-2.5 py-2 text-[13px] text-foreground">{labelsErrorMessage}</div>
  ) : isLoadingLabels ? (
    <div className="px-2.5 py-2 text-[13px] text-muted-foreground">Loading labels…</div>
  ) : userLabels.length > 0 ? (
    <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
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
        className="fixed z-50"
        data-search-dropdown-content
        onPointerEnter={cancelCloseLabelsSubmenu}
        onPointerLeave={scheduleCloseLabelsSubmenu}
        style={{
          height: Math.max(labelsLayout.height, labelsLayout.triggerHeight),
          left: labelsLayout.left - 8,
          top: labelsLayout.top,
          width: 296,
        }}
      >
        <div aria-hidden className="absolute top-0 left-0 h-full w-2" />
        <div
          aria-label="Labels"
          className="absolute top-0 left-2 w-72 rounded-lg border bg-popover p-1 shadow-lg"
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
            className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border bg-popover p-2 shadow-lg will-change-transform"
            data-search-dropdown-content
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            <div className="flex flex-col gap-3">
              {searchFilterSections.map((section) => (
                <div className="flex flex-col gap-1" key={section.label}>
                  <SearchDropdownSectionLabel>{section.label}</SearchDropdownSectionLabel>
                  {section.options.map((option) => (
                    <SearchDropdownRow
                      active={isSearchFilterOptionActive(draftSearchState.filters, option.filter)}
                      highlighted={
                        highlightedItemKey === `filter:${option.filter.type}:${option.filter.value}`
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
                  onPointerEnter={() => {
                    cancelCloseLabelsSubmenu();
                    setIsLabelsSubmenuOpen(true);
                  }}
                  onPointerLeave={() => {
                    scheduleCloseLabelsSubmenu();
                  }}
                >
                  <button
                    aria-expanded={showLabelsSubmenu}
                    aria-haspopup="true"
                    className={cn(
                      "relative z-50 flex h-8 max-h-8 min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-muted focus-visible:bg-muted",
                      {
                        "bg-muted": isLabelHighlighted,
                        "bg-muted/80 ring-1 ring-border ring-inset": selectedUserLabelKeys.size > 0,
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
                      className="size-3.5 shrink-0 text-muted-foreground"
                      icon={ArrowRight01Icon}
                    />
                  </button>

                  {showLabelsSubmenu && (
                    <>
                      <svg
                        aria-hidden
                        className="pointer-events-none absolute top-0 left-0 z-40"
                        height={labelsLayout.height}
                        viewBox={`0 0 ${labelsLayout.coneWidth} ${labelsLayout.height}`}
                        width={labelsLayout.coneWidth}
                      >
                        <polygon
                          className="pointer-events-auto"
                          fill="transparent"
                          points={`0 ${labelsLayout.coneOriginY} ${labelsLayout.coneWidth} 0 ${labelsLayout.coneWidth} ${labelsLayout.height}`}
                          pointerEvents="all"
                        />
                      </svg>
                      {labelsSubmenu}
                    </>
                  )}
                </div>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
