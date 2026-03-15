"use client";

import {
  ArrowRight01Icon,
  Flag01Icon,
  Folder01Icon,
  InboxUnreadIcon,
  Search01Icon,
  StarIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Field, Input, cn } from "@quietr/ui";
import { AnimatePresence, motion } from "motion/react";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";
import { SearchDateTimeField } from "./message-list-search-date-time-field";
import {
  SEARCH_CATEGORY_FILTER_OPTIONS,
  SEARCH_DROPDOWN_SECTIONS,
  SEARCH_STATE_FILTER_OPTIONS_BY_ID,
  normalizeLabelSelectionKey,
  selectCategoryFilterInSearchState,
  toggleStateFilterInSearchState,
  toggleUserLabelInSearchState,
  type SearchDateFilterId,
  type SearchDropdownSectionId,
  type StructuredSearchState,
} from "./message-list-search-state";

const layoutTransition = {
  damping: 34,
  mass: 0.7,
  stiffness: 360,
  type: "spring" as const,
};

const panelTransition = {
  layout: layoutTransition,
  opacity: { duration: 0.16, ease: "easeOut" as const },
  y: { duration: 0.16, ease: "easeOut" as const },
};

const STATE_FILTER_ICONS = {
  unread: InboxUnreadIcon,
  starred: StarIcon,
  important: Flag01Icon,
} as const;

const SECTION_ICONS = {
  categories: Folder01Icon,
  labels: Tag01Icon,
} as const;

const STATE_FILTER_IDS = ["unread", "starred", "important"] as const;

const DATE_FIELDS = [
  { id: "after", label: "After" },
  { id: "before", label: "Before" },
] as const satisfies ReadonlyArray<{
  id: SearchDateFilterId;
  label: string;
}>;

type SearchStateUpdater = (
  updater: StructuredSearchState | ((current: StructuredSearchState) => StructuredSearchState),
) => void;

const SearchActionButton = ({
  ariaExpanded,
  children,
  className,
  icon,
  onClick,
  pressed,
  trailingIcon,
  trailingIconClassName,
}: {
  ariaExpanded?: boolean;
  children: string;
  className: string;
  icon: IconSvgElement;
  onClick: () => void;
  pressed?: boolean;
  trailingIcon?: IconSvgElement;
  trailingIconClassName?: string;
}) => (
  <motion.button
    layout="position"
    aria-expanded={ariaExpanded}
    aria-pressed={pressed}
    className={cn(className, pressed && "bg-muted ring-1 ring-border ring-inset")}
    onClick={onClick}
    transition={{ layout: layoutTransition }}
    type="button"
  >
    <HugeiconsIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" icon={icon} />
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {trailingIcon ? (
      <HugeiconsIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-muted-foreground", trailingIconClassName)}
        icon={trailingIcon}
      />
    ) : null}
  </motion.button>
);

const SearchToggleButton = ({
  children,
  icon,
  onClick,
  pressed = false,
}: {
  children: string;
  icon: IconSvgElement;
  onClick: () => void;
  pressed?: boolean;
}) => (
  <SearchActionButton
    className="flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
    icon={icon}
    onClick={onClick}
    pressed={pressed}
  >
    {children}
  </SearchActionButton>
);

const SearchSectionTrigger = ({
  children,
  icon,
  onClick,
}: {
  children: string;
  icon: IconSvgElement;
  onClick: () => void;
}) => (
  <SearchActionButton
    ariaExpanded={false}
    className="flex min-h-8 w-full items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors outline-none hover:border-muted-foreground/60 hover:bg-muted focus-visible:border-muted-foreground/60 focus-visible:bg-muted"
    icon={icon}
    onClick={onClick}
    trailingIcon={ArrowRight01Icon}
  >
    {children}
  </SearchActionButton>
);

const SearchSectionBackButton = ({
  children,
  icon,
  onClick,
}: {
  children: string;
  icon: IconSvgElement;
  onClick: () => void;
}) => (
  <SearchActionButton
    className="flex min-h-8 w-full items-center gap-2 rounded-md bg-muted/80 px-2.5 py-1.5 text-left text-[13px] font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
    icon={icon}
    onClick={onClick}
    trailingIcon={ArrowRight01Icon}
    trailingIconClassName="rotate-180"
  >
    {children}
  </SearchActionButton>
);

const SearchIndentedButton = ({
  children,
  onClick,
  pressed = false,
}: {
  children: string;
  onClick: () => void;
  pressed?: boolean;
}) => (
  <motion.button
    layout="position"
    aria-pressed={pressed}
    className={cn(
      "flex min-h-8 w-full items-center rounded-md px-2.5 py-1.5 pl-9 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted",
      pressed && "bg-muted ring-1 ring-border ring-inset",
    )}
    onClick={onClick}
    transition={{ layout: layoutTransition }}
    type="button"
  >
    <span className="min-w-0 flex-1 truncate">{children}</span>
  </motion.button>
);

const SearchCategoriesSection = ({
  categoryFilter,
  updateSearchState,
}: {
  categoryFilter: StructuredSearchState["categoryFilter"];
  updateSearchState: SearchStateUpdater;
}) => (
  <motion.div layout className="space-y-1" transition={{ layout: layoutTransition }}>
    {SEARCH_CATEGORY_FILTER_OPTIONS.map((option) => (
      <SearchIndentedButton
        key={option.id}
        onClick={() =>
          updateSearchState((current) => selectCategoryFilterInSearchState(current, option.id))
        }
        pressed={categoryFilter === option.id}
      >
        {option.label}
      </SearchIndentedButton>
    ))}
  </motion.div>
);

const SearchLabelsSection = ({
  draftSearchState,
  filteredUserLabels,
  labelFilterQuery,
  labelsErrorMessage,
  onLabelFilterQueryChange,
  updateSearchState,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  filteredUserLabels: readonly GmailLabelListItem[];
  labelFilterQuery: string;
  labelsErrorMessage: string | null;
  onLabelFilterQueryChange: (value: string) => void;
  updateSearchState: SearchStateUpdater;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const selectedUserLabelKeys = new Set(
    draftSearchState.userLabels.map((value) => normalizeLabelSelectionKey(value)),
  );

  return (
    <motion.div layout className="space-y-1" transition={{ layout: layoutTransition }}>
      <Field className="min-w-0">
        <div className="relative flex items-center">
          <HugeiconsIcon
            aria-hidden
            className="absolute left-2.5 size-4 shrink-0 text-muted-foreground"
            icon={Search01Icon}
          />
          <Input
            autoCapitalize="off"
            autoCorrect="off"
            className="pl-9 text-[13px]"
            onChange={(event) => {
              onLabelFilterQueryChange(event.currentTarget.value);
            }}
            placeholder="Filter labels"
            size="sm"
            spellCheck={false}
            type="search"
            value={labelFilterQuery}
          />
        </div>
      </Field>

      {labelsErrorMessage ? (
        <div className="px-2.5 py-2 text-[13px] text-foreground">{labelsErrorMessage}</div>
      ) : filteredUserLabels.length > 0 ? (
        <motion.div
          layout
          className="max-h-56 space-y-1 overflow-y-auto"
          transition={{ layout: layoutTransition }}
        >
          {filteredUserLabels.map((label) => (
            <SearchIndentedButton
              key={label.id}
              onClick={() =>
                updateSearchState((current) => toggleUserLabelInSearchState(current, label.name))
              }
              pressed={selectedUserLabelKeys.has(normalizeLabelSelectionKey(label.name))}
            >
              {label.name}
            </SearchIndentedButton>
          ))}
        </motion.div>
      ) : (
        <div className="px-2.5 py-2 text-[13px] text-muted-foreground">
          {userLabels.length > 0 ? "No matching labels." : "No custom labels."}
        </div>
      )}
    </motion.div>
  );
};

const ClosedDropdownContent = ({
  draftSearchState,
  onDateFieldChange,
  onOpenDateFieldChange,
  onOpenSectionChange,
  openDateField,
  updateSearchState,
}: {
  draftSearchState: StructuredSearchState;
  onDateFieldChange: (filterId: SearchDateFilterId, value: string) => void;
  onOpenDateFieldChange: (value: SearchDateFilterId | null) => void;
  onOpenSectionChange: (value: SearchDropdownSectionId | null) => void;
  openDateField: SearchDateFilterId | null;
  updateSearchState: SearchStateUpdater;
}) => (
  <motion.div
    key="closed"
    layout
    animate={{ opacity: 1, y: 0 }}
    className="space-y-1"
    exit={{ opacity: 0, y: -4 }}
    initial={{ opacity: 0, y: -4 }}
    transition={panelTransition}
  >
    {STATE_FILTER_IDS.map((filterId) => {
      const option = SEARCH_STATE_FILTER_OPTIONS_BY_ID[filterId];

      return (
        <SearchToggleButton
          icon={STATE_FILTER_ICONS[filterId]}
          key={option.id}
          onClick={() =>
            updateSearchState((current) => toggleStateFilterInSearchState(current, option.id))
          }
          pressed={draftSearchState.stateFilters.includes(option.id)}
        >
          {option.label}
        </SearchToggleButton>
      );
    })}

    {DATE_FIELDS.map((field) => (
      <SearchDateTimeField
        key={field.id}
        label={field.label}
        onChange={(value) => {
          onDateFieldChange(field.id, value);
        }}
        onOpenChange={onOpenDateFieldChange}
        open={openDateField === field.id}
        value={draftSearchState[field.id]}
        valueKey={field.id}
      />
    ))}

    {SEARCH_DROPDOWN_SECTIONS.map((section) => (
      <SearchSectionTrigger
        icon={SECTION_ICONS[section.id]}
        key={section.id}
        onClick={() => {
          onOpenSectionChange(section.id);
        }}
      >
        {section.label}
      </SearchSectionTrigger>
    ))}
  </motion.div>
);

const OpenSectionContent = ({
  draftSearchState,
  filteredUserLabels,
  labelFilterQuery,
  labelsErrorMessage,
  onLabelFilterQueryChange,
  onOpenSectionChange,
  openSection,
  updateSearchState,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  filteredUserLabels: readonly GmailLabelListItem[];
  labelFilterQuery: string;
  labelsErrorMessage: string | null;
  onLabelFilterQueryChange: (value: string) => void;
  onOpenSectionChange: (value: SearchDropdownSectionId | null) => void;
  openSection: SearchDropdownSectionId;
  updateSearchState: SearchStateUpdater;
  userLabels: readonly GmailLabelListItem[];
}) => {
  const section = SEARCH_DROPDOWN_SECTIONS.find((value) => value.id === openSection);
  if (!section) return null;

  return (
    <motion.div
      key={section.id}
      layout
      animate={{ opacity: 1, y: 0 }}
      className="space-y-1"
      exit={{ opacity: 0, y: 4 }}
      initial={{ opacity: 0, y: 4 }}
      transition={panelTransition}
    >
      <SearchSectionBackButton
        icon={SECTION_ICONS[section.id]}
        onClick={() => {
          onOpenSectionChange(null);
        }}
      >
        {section.label}
      </SearchSectionBackButton>

      {section.id === "categories" ? (
        <SearchCategoriesSection
          categoryFilter={draftSearchState.categoryFilter}
          updateSearchState={updateSearchState}
        />
      ) : (
        <SearchLabelsSection
          draftSearchState={draftSearchState}
          filteredUserLabels={filteredUserLabels}
          labelFilterQuery={labelFilterQuery}
          labelsErrorMessage={labelsErrorMessage}
          onLabelFilterQueryChange={onLabelFilterQueryChange}
          updateSearchState={updateSearchState}
          userLabels={userLabels}
        />
      )}
    </motion.div>
  );
};

export const MessageListSearchDropdown = ({
  draftSearchState,
  filteredUserLabels,
  labelFilterQuery,
  labelsErrorMessage,
  onDateFieldChange,
  onLabelFilterQueryChange,
  onOpenDateFieldChange,
  onOpenSectionChange,
  openDateField,
  openSection,
  updateSearchState,
  userLabels,
}: {
  draftSearchState: StructuredSearchState;
  filteredUserLabels: readonly GmailLabelListItem[];
  labelFilterQuery: string;
  labelsErrorMessage: string | null;
  onDateFieldChange: (filterId: SearchDateFilterId, value: string) => void;
  onLabelFilterQueryChange: (value: string) => void;
  onOpenDateFieldChange: (value: SearchDateFilterId | null) => void;
  onOpenSectionChange: (value: SearchDropdownSectionId | null) => void;
  openDateField: SearchDateFilterId | null;
  openSection: SearchDropdownSectionId | null;
  updateSearchState: SearchStateUpdater;
  userLabels: readonly GmailLabelListItem[];
}) => (
  <motion.div layout transition={{ layout: layoutTransition }}>
    <AnimatePresence initial={false} mode="wait">
      {openSection ? (
        <OpenSectionContent
          draftSearchState={draftSearchState}
          filteredUserLabels={filteredUserLabels}
          labelFilterQuery={labelFilterQuery}
          labelsErrorMessage={labelsErrorMessage}
          onLabelFilterQueryChange={onLabelFilterQueryChange}
          onOpenSectionChange={onOpenSectionChange}
          openSection={openSection}
          updateSearchState={updateSearchState}
          userLabels={userLabels}
        />
      ) : (
        <ClosedDropdownContent
          draftSearchState={draftSearchState}
          onDateFieldChange={onDateFieldChange}
          onOpenDateFieldChange={onOpenDateFieldChange}
          onOpenSectionChange={onOpenSectionChange}
          openDateField={openDateField}
          updateSearchState={updateSearchState}
        />
      )}
    </AnimatePresence>
  </motion.div>
);
