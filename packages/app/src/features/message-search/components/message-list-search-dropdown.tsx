"use client";

import {
  ArrowDown01Icon,
  Cancel01Icon,
  Tag01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { mailboxLabelPillToneByColor } from "@quieter/app/features/message-labels/domain/mailbox-label-presentation";
import type { searchFilterOptions } from "@quieter/app/features/message-search/components/message-list-search-filter-options";
import { isFixedValueFilter } from "@quieter/app/features/message-search/components/message-list-search/message-list-search-utils";
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
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { popupSurfaceClassName } from "@quieter/ui/popup-surface";
import { Text } from "@quieter/ui/text";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type SearchFilterSelectionState = "exclude" | "include";

const searchOptionGridClassName = "grid grid-cols-1 gap-0.5 @xs:grid-cols-2";

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
): SearchFilterSelectionState | null => {
  const filter = filters.find(
    (candidateFilter) =>
      candidateFilter.value.trim().length > 0 &&
      candidateFilter.type === optionFilter.type &&
      (optionFilter.value.length === 0 ||
        candidateFilter.value === optionFilter.value)
  );
  if (filter === undefined) {
    return null;
  }
  return isFixedValueFilter(optionFilter) && filter.negated === true
    ? "exclude"
    : "include";
};

const SearchDropdownOption = ({
  children,
  hint,
  leading,
  onClick,
  pressed,
  selectionState,
}: {
  children: ReactNode;
  hint?: string;
  leading?: ReactNode;
  onClick: () => void;
  pressed?: boolean | "mixed";
  selectionState: SearchFilterSelectionState | null;
}) => (
  <Button
    aria-pressed={pressed}
    className="min-w-0"
    data-search-option=""
    focusRing="inset"
    onClick={onClick}
    size="sm"
    title={hint}
    variant="option"
  >
    {leading}
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
      {selectionState === "exclude" && <span>Not</span>}
      {children}
    </span>
    {selectionState === "include" && (
      <>
        <Icon aria-hidden icon={Tick01Icon} />
        {pressed === undefined && <span className="sr-only">applied</span>}
      </>
    )}
  </Button>
);

type MessageListSearchDropdownProps = {
  draftSearchState: StructuredSearchState;
  filterOptions: typeof searchFilterOptions;
  id: string;
  isOpen: boolean;
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
  onDismiss: () => void;
  onRunSearch: () => void;
  onSelectFilter: (filter: SearchFilterChip) => void;
  onToggleLabel: (labelName: string) => void;
  userLabels: readonly MailboxLabel[];
};

const SearchDropdownPanel = ({
  draftSearchState,
  filterOptions,
  id,
  isLoadingLabels,
  labelsErrorMessage,
  onDismiss,
  onRunSearch,
  onSelectFilter,
  onToggleLabel,
  userLabels,
}: Omit<MessageListSearchDropdownProps, "isOpen">) => {
  const titleId = useId();
  const labelsId = useId();
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const labelsSectionRef = useRef<HTMLDivElement>(null);
  const selectedLabelStates = new Map<string, SearchFilterSelectionState>();
  for (const filter of draftSearchState.filters) {
    if (filter.type === "label") {
      selectedLabelStates.set(
        normalizeLabelSelectionKey(filter.value),
        filter.negated === true ? "exclude" : "include"
      );
    }
  }
  const reducedMotion = useReducedMotion();
  const enter = { opacity: 1, scale: 1, transformOrigin: "top", y: 0 };
  const exit =
    reducedMotion === true
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.97, transformOrigin: "top", y: -4 };

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const labelsSection = labelsSectionRef.current;
    if (isLabelsOpen && container && labelsSection) {
      container.scrollTop = labelsSection.offsetTop;
    }
  }, [isLabelsOpen]);

  let labelsStatus: ReactNode = null;
  if (labelsErrorMessage) {
    labelsStatus = (
      <Text className="mx-2.5 my-1" role="alert" size="sm" tone="destructive">
        {labelsErrorMessage}
      </Text>
    );
  } else if (isLoadingLabels) {
    labelsStatus = (
      <output className="block px-2.5 py-1 text-body-sm text-muted-fg">
        Loading labels…
      </output>
    );
  } else if (userLabels.length === 0) {
    labelsStatus = (
      <Text className="mx-2.5 my-1" size="sm" tone="muted">
        No custom labels.
      </Text>
    );
  }

  return (
    <m.section
      animate={enter}
      aria-labelledby={titleId}
      className={cn(
        popupSurfaceClassName,
        "absolute inset-x-0 top-8 z-30 mt-2 flex max-h-[min(26rem,calc(100dvh-5rem))] flex-col overflow-hidden rounded-xl p-1 @md:max-w-sm"
      )}
      data-blocking-overlay=""
      data-search-dropdown-content
      exit={exit}
      id={id}
      initial={exit}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
          return;
        }
        const options = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[data-search-option]"
          ),
        ];
        const current =
          event.target instanceof HTMLButtonElement
            ? options.indexOf(event.target)
            : -1;
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const next =
          current === -1 && offset === -1
            ? options.length - 1
            : (current + offset + options.length) % options.length;
        event.preventDefault();
        options[next]?.focus();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 pb-1 pl-2.5">
        <Text as="h2" id={titleId} size="sm" weight="medium">
          Filters
        </Text>
        <IconButtonTooltip label="Close filters">
          <Button
            aria-label="Close filters"
            onClick={onDismiss}
            focusRing="inset"
            size="icon-sm"
            variant="ghost"
          >
            <Icon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>

      <div
        className="@container relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        ref={scrollContainerRef}
      >
        <div className="flex flex-col gap-1.5">
          {createSearchFilterSections(filterOptions).map(
            (section) =>
              section.options.length > 0 && (
                <fieldset className="min-w-0" key={section.label}>
                  <legend className="px-2.5 pb-0.5 text-caption text-muted-fg">
                    {section.label}
                  </legend>
                  <div className={searchOptionGridClassName}>
                    {section.options.map((option) => {
                      const selectionState = getSearchFilterOptionState(
                        draftSearchState.filters,
                        option.filter
                      );
                      const itemKey = `filter:${option.filter.type}:${option.filter.value}`;
                      const pressed =
                        selectionState === "exclude"
                          ? "mixed"
                          : selectionState === "include";
                      return (
                        <SearchDropdownOption
                          hint={option.hint}
                          key={itemKey}
                          leading={<Icon aria-hidden icon={option.icon} />}
                          onClick={() => {
                            onSelectFilter(option.filter);
                          }}
                          // Editable filters add another value instead of toggling.
                          pressed={
                            isFixedValueFilter(option.filter)
                              ? pressed
                              : undefined
                          }
                          selectionState={selectionState}
                        >
                          <span className="min-w-0 truncate">
                            {option.label}
                          </span>
                        </SearchDropdownOption>
                      );
                    })}
                  </div>
                </fieldset>
              )
          )}

          <div className="flex flex-col gap-0.5" ref={labelsSectionRef}>
            <Button
              aria-controls={isLabelsOpen ? labelsId : undefined}
              aria-expanded={isLabelsOpen}
              data-search-option=""
              focusRing="inset"
              onClick={() => {
                setIsLabelsOpen(!isLabelsOpen);
              }}
              size="sm"
              variant="ghost"
            >
              <Icon aria-hidden icon={Tag01Icon} />
              <span className="min-w-0 flex-1 truncate text-left">Labels</span>
              {selectedLabelStates.size > 0 && (
                <span>{selectedLabelStates.size}</span>
              )}
              <Icon
                aria-hidden
                className={cn({ "rotate-180": isLabelsOpen })}
                icon={ArrowDown01Icon}
              />
            </Button>

            {isLabelsOpen && (
              <div id={labelsId}>
                {labelsStatus}
                {userLabels.length > 0 && (
                  <fieldset
                    aria-label="Labels"
                    className={cn(searchOptionGridClassName, "min-w-0")}
                  >
                    {userLabels.map((label) => {
                      const selectionState =
                        selectedLabelStates.get(
                          normalizeLabelSelectionKey(label.id)
                        ) ??
                        selectedLabelStates.get(
                          normalizeLabelSelectionKey(label.name)
                        ) ??
                        null;
                      return (
                        <SearchDropdownOption
                          key={label.id}
                          onClick={() => {
                            onToggleLabel(label.name);
                          }}
                          pressed={
                            selectionState === "exclude"
                              ? "mixed"
                              : selectionState === "include"
                          }
                          selectionState={selectionState}
                        >
                          <Pill
                            className="min-w-0 shrink"
                            customColor={
                              label.color?.startsWith("#") === true
                                ? label.color
                                : undefined
                            }
                            size="xs"
                            title={label.name}
                            tone={
                              mailboxLabelPillToneByColor[label.color ?? "gray"]
                            }
                          >
                            <span className="truncate">{label.name}</span>
                          </Pill>
                        </SearchDropdownOption>
                      );
                    })}
                  </fieldset>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <ActionFooter className="mt-1 shrink-0">
        <Button
          data-search-option=""
          onClick={onRunSearch}
          size="sm"
          type="button"
        >
          Search
        </Button>
      </ActionFooter>
    </m.section>
  );
};

export const MessageListSearchDropdown = ({
  isOpen,
  ...panelProps
}: MessageListSearchDropdownProps) => (
  <LazyMotion features={domAnimation}>
    <AnimatePresence initial={false}>
      {isOpen && <SearchDropdownPanel {...panelProps} />}
    </AnimatePresence>
  </LazyMotion>
);
