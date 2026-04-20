"use client";

import {
  Calendar01Icon,
  Calendar03Icon,
  MailAtSign01Icon,
  MailAtSign02Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quietr/ui";
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
      "flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted",
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
    {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
  </button>
);

export const MessageListSearchDropdown = ({
  draftSearchState,
  highlightedItemKey,
  isLoadingLabels,
  labelsErrorMessage,
  onSelectFilter,
  onToggleLabel,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  highlightedItemKey: string | null;
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
  onSelectFilter: (type: SearchFieldFilterType) => void;
  onToggleLabel: (labelName: string) => void;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const selectedUserLabelKeys = new Set(
    draftSearchState.filters
      .filter((filter) => filter.type === "label")
      .map((filter) => normalizeLabelSelectionKey(filter.value)),
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
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

      <div className="space-y-1">
        <SearchDropdownSectionLabel>Labels</SearchDropdownSectionLabel>
        {labelsErrorMessage ? (
          <div className="px-2.5 py-2 text-[13px] text-foreground">{labelsErrorMessage}</div>
        ) : isLoadingLabels ? (
          <div className="px-2.5 py-2 text-[13px] text-muted-foreground">Loading labels...</div>
        ) : userLabels.length > 0 ? (
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {userLabels.map((label) => (
              <SearchDropdownRow
                active={selectedUserLabelKeys.has(normalizeLabelSelectionKey(label.name))}
                highlighted={
                  highlightedItemKey === `label:${normalizeLabelSelectionKey(label.name)}`
                }
                icon={Tag01Icon}
                key={label.id}
                label={label.name}
                onClick={() => onToggleLabel(label.name)}
              />
            ))}
          </div>
        ) : (
          <div className="px-2.5 py-2 text-[13px] text-muted-foreground">No custom labels.</div>
        )}
      </div>
    </div>
  );
};
