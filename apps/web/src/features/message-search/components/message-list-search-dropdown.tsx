"use client";

import {
  Calendar01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  MailAtSign01Icon,
  MailAtSign02Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";
import {
  normalizeLabelSelectionKey,
  type SearchFieldFilterType,
  type StructuredSearchState,
} from "~/features/message-search/state/message-list-search-state";

export const searchFilterOptions: ReadonlyArray<{
  hint: string;
  icon: IconSvgElement;
  label: string;
  type: SearchFieldFilterType;
}> = [
  { hint: "before:", icon: Calendar01Icon, label: "Before", type: "before" },
  { hint: "after:", icon: Calendar03Icon, label: "After", type: "after" },
  { hint: "from:", icon: MailAtSign01Icon, label: "From", type: "from" },
  { hint: "to:", icon: MailAtSign02Icon, label: "To", type: "to" },
];

const SearchDropdownSectionLabel = ({ children }: { children: string }) => (
  <p className="px-2.5 pb-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
    {children}
  </p>
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
  onSelectFilter: (type: SearchFieldFilterType) => void;
  onToggleLabel: (labelName: string) => void;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const [isLabelsSubmenuOpen, setIsLabelsSubmenuOpen] = useState(false);
  const [labelsConeWidth, setLabelsConeWidth] = useState(320);
  const [labelsConeOriginY, setLabelsConeOriginY] = useState(32);
  const [labelsSubmenuHeight, setLabelsSubmenuHeight] = useState(224);
  const [labelsSubmenuPosition, setLabelsSubmenuPosition] = useState({
    left: 0,
    top: 0,
    triggerHeight: 32,
  });
  const closeLabelsSubmenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelsSubmenuRef = useRef<HTMLDivElement>(null);
  const labelsTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedUserLabelKeys = new Set(
    draftSearchState.filters
      .filter((filter) => filter.type === "label")
      .map((filter) => normalizeLabelSelectionKey(filter.value)),
  );
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

    setLabelsConeWidth(trigger.offsetWidth + 8);
    setLabelsConeOriginY(trigger.offsetHeight);
    setLabelsSubmenuHeight(submenu.offsetHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const submenuWidth = submenu.offsetWidth;
    const submenuHeight = submenu.offsetHeight;
    const viewportGap = 8;
    setLabelsSubmenuPosition({
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
    <div className="px-2.5 py-2 text-[13px] text-muted-foreground">Loading labels...</div>
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
          height: Math.max(labelsSubmenuHeight, labelsSubmenuPosition.triggerHeight),
          left: labelsSubmenuPosition.left - 8,
          top: labelsSubmenuPosition.top,
          width: 296,
        }}
      >
        <div aria-hidden className="absolute top-0 left-0 h-full w-2" />
        <div
          aria-label="Labels"
          className="absolute top-0 left-2 w-72 rounded-lg border bg-popover p-1 shadow-lg"
          ref={labelsSubmenuRef}
          role="group"
        >
          {labelsContent}
        </div>
      </div>,
      document.body,
    );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      aria-label="Search filters"
      className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border bg-popover p-2 shadow-lg"
      data-search-dropdown-content
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      role="group"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <SearchDropdownSectionLabel>Filters</SearchDropdownSectionLabel>
          {searchFilterOptions.map((option) => (
            <SearchDropdownRow
              active={draftSearchState.filters.some((filter) => filter.type === option.type)}
              highlighted={highlightedItemKey === `filter:${option.type}`}
              hint={option.hint}
              icon={option.icon}
              key={option.type}
              label={option.label}
              onClick={() => onSelectFilter(option.type)}
            />
          ))}
        </div>

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
                  height={labelsSubmenuHeight}
                  viewBox={`0 0 ${labelsConeWidth} ${labelsSubmenuHeight}`}
                  width={labelsConeWidth}
                >
                  <polygon
                    className="pointer-events-auto"
                    fill="transparent"
                    points={`0 ${labelsConeOriginY} ${labelsConeWidth} 0 ${labelsConeWidth} ${labelsSubmenuHeight}`}
                    pointerEvents="all"
                  />
                </svg>
                {labelsSubmenu}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
