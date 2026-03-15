"use client";

import { ArrowUp01Icon, Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Field, Input } from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import { SpinWhileActive } from "../spin-while-active";
import { MessageListSearchDropdown } from "./message-list-search-dropdown";
import {
  formatSearchDateTimeDisplayValue,
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
  removeLastStructuredSearchChip,
  removeUserLabelSelection,
  SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID,
  SEARCH_STATE_FILTER_OPTIONS_BY_ID,
  serializeStructuredSearchQuery,
  toggleStateFilterInSearchState,
  type SearchDateFilterId,
  type SearchDropdownSectionId,
  type StructuredSearchState,
} from "./message-list-search-state";

export type MessageListSearchProps = {
  isRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  onScrollToTop: () => void | Promise<void>;
  onSearch: (query: string) => void;
  searchQuery: string;
};

const layoutTransition = {
  damping: 34,
  mass: 0.7,
  stiffness: 360,
  type: "spring" as const,
};

const SearchFilterChip = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <motion.span
    layout="position"
    className="inline-flex max-w-full items-center gap-1 rounded-md border border-input px-1.5 py-0.5 text-xs text-foreground"
    transition={{ layout: layoutTransition }}
  >
    <span className="truncate">{label}</span>
    <button
      aria-label={`Remove ${label} filter`}
      className="rounded-sm px-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemove();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      type="button"
    >
      x
    </button>
  </motion.span>
);

export const MessageListSearch = ({
  isRefreshing,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLElement>(null!);
  const [draftSearchState, setDraftSearchState] = useState(() =>
    parseStructuredSearchQuery(searchQuery),
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [labelFilterQuery, setLabelFilterQuery] = useState("");
  const [openSection, setOpenSection] = useState<SearchDropdownSectionId | null>(null);
  const [openDateField, setOpenDateField] = useState<SearchDateFilterId | null>(null);

  const labelsQuery = useQuery(labelsQueryOptions(isDropdownOpen));
  const userLabels = useMemo(() => getUserLabels(labelsQuery.data ?? []), [labelsQuery.data]);
  const filteredUserLabels = useMemo(() => {
    const normalizedLabelFilterQuery = labelFilterQuery.trim().toLocaleLowerCase();
    if (!normalizedLabelFilterQuery) return userLabels;
    return userLabels.filter((label) =>
      label.name.toLocaleLowerCase().includes(normalizedLabelFilterQuery),
    );
  }, [labelFilterQuery, userLabels]);

  useEffect(() => {
    setDraftSearchState(parseStructuredSearchQuery(searchQuery));
  }, [searchQuery]);

  useEffect(() => {
    if (openSection !== "labels") setLabelFilterQuery("");
  }, [openSection]);

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setLabelFilterQuery("");
    setOpenDateField(null);
    setOpenSection(null);
  }, []);

  const commitSearchState = useCallback(
    (nextState: StructuredSearchState, closeAfterCommit = false) => {
      setDraftSearchState(nextState);
      void onScrollToTop();
      onSearch(serializeStructuredSearchQuery(nextState));
      if (closeAfterCommit) closeDropdown();
    },
    [closeDropdown, onScrollToTop, onSearch],
  );

  const updateSearchState = useCallback(
    (
      updater: StructuredSearchState | ((current: StructuredSearchState) => StructuredSearchState),
      closeAfterCommit = false,
    ) => {
      const nextState = typeof updater === "function" ? updater(draftSearchState) : updater;
      commitSearchState(nextState, closeAfterCommit);
    },
    [commitSearchState, draftSearchState],
  );

  const selectedSearchChips = useMemo(
    () => [
      ...draftSearchState.stateFilters.map((stateFilterId) => {
        const option = SEARCH_STATE_FILTER_OPTIONS_BY_ID[stateFilterId];
        return {
          key: `state:${stateFilterId}`,
          label: option.label,
          onRemove: () =>
            updateSearchState((current) => toggleStateFilterInSearchState(current, stateFilterId)),
        };
      }),
      ...(draftSearchState.categoryFilter
        ? [
            {
              key: `category:${draftSearchState.categoryFilter}`,
              label: SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID[draftSearchState.categoryFilter].label,
              onRemove: () =>
                updateSearchState((current) => ({ ...current, categoryFilter: null })),
            },
          ]
        : []),
      ...(draftSearchState.after
        ? [
            {
              key: "date:after",
              label: `After ${formatSearchDateTimeDisplayValue(draftSearchState.after)}`,
              onRemove: () => updateSearchState((current) => ({ ...current, after: "" })),
            },
          ]
        : []),
      ...(draftSearchState.before
        ? [
            {
              key: "date:before",
              label: `Before ${formatSearchDateTimeDisplayValue(draftSearchState.before)}`,
              onRemove: () => updateSearchState((current) => ({ ...current, before: "" })),
            },
          ]
        : []),
      ...draftSearchState.userLabels.map((userLabel) => ({
        key: `label:${normalizeLabelSelectionKey(userLabel)}`,
        label:
          userLabels.find(
            (label) =>
              normalizeLabelSelectionKey(label.name) === normalizeLabelSelectionKey(userLabel),
          )?.name ?? userLabel,
        onRemove: () =>
          updateSearchState((current) => ({
            ...current,
            userLabels: removeUserLabelSelection(current.userLabels, userLabel),
          })),
      })),
    ],
    [draftSearchState, updateSearchState, userLabels],
  );

  const handleDropdownBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && containerRef.current?.contains(nextTarget)) return;
      closeDropdown();
    },
    [closeDropdown],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node))
        closeDropdown();
    };
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [closeDropdown, isDropdownOpen]);

  return (
    <div className="border-b border-border bg-background-light px-4 py-3" role="search">
      <div className="flex items-center gap-2">
        <Button
          disabled={isRefreshing}
          onClick={() => void onRefresh()}
          size="icon-sm"
          variant="outline"
        >
          <SpinWhileActive active={isRefreshing}>
            <HugeiconsIcon icon={Refresh01Icon} />
          </SpinWhileActive>
        </Button>

        <div
          ref={containerRef}
          className="relative min-w-0 flex-1"
          onBlurCapture={handleDropdownBlur}
        >
          <Field className="min-w-0">
            <motion.div
              layout
              className="flex min-h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-0 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
              onClick={(event) => {
                if (event.target instanceof HTMLButtonElement) return;
                setIsDropdownOpen(true);
                searchInputRef.current?.focus();
              }}
              transition={{ layout: layoutTransition }}
            >
              <motion.div
                layout
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                transition={{ layout: layoutTransition }}
              >
                {selectedSearchChips.map((chip) => (
                  <SearchFilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
                ))}

                <Input
                  autoCapitalize="off"
                  autoCorrect="off"
                  chrome="ghost"
                  className="min-w-[10ch] flex-1 px-0 text-[13px] focus-visible:ring-0"
                  name="query"
                  onChange={(event) => {
                    setDraftSearchState((current) => ({
                      ...current,
                      text: event.currentTarget.value,
                    }));
                  }}
                  onFocus={() => setIsDropdownOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitSearchState(draftSearchState, true);
                      return;
                    }
                    if (event.key === "Escape") {
                      closeDropdown();
                      event.currentTarget.blur();
                      return;
                    }
                    if (event.key === "Backspace" && draftSearchState.text.length === 0) {
                      event.preventDefault();
                      updateSearchState(removeLastStructuredSearchChip(draftSearchState));
                    }
                  }}
                  placeholder={selectedSearchChips.length > 0 ? "Search within filters" : "Search"}
                  ref={searchInputRef}
                  size="sm"
                  spellCheck={false}
                  type="search"
                  value={draftSearchState.text}
                />
              </motion.div>

              <Button
                aria-label="Search"
                className="h-6 w-6 shrink-0 self-center text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  commitSearchState(draftSearchState, true);
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={Search01Icon} />
              </Button>
            </motion.div>
          </Field>

          <AnimatePresence initial={false}>
            {isDropdownOpen ? (
              <motion.div
                key="message-list-search-dropdown"
                layout
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-input bg-popover p-1.5 shadow-md"
                exit={{ opacity: 0, y: -4 }}
                initial={{ opacity: 0, y: -4 }}
                transition={{
                  layout: layoutTransition,
                  opacity: { duration: 0.16, ease: "easeOut" },
                  y: { duration: 0.16, ease: "easeOut" },
                }}
              >
                <MessageListSearchDropdown
                  draftSearchState={draftSearchState}
                  filteredUserLabels={labelsQuery.isPending ? [] : filteredUserLabels}
                  labelFilterQuery={labelFilterQuery}
                  labelsErrorMessage={
                    labelsQuery.isPending ? null : (labelsQuery.error?.message ?? null)
                  }
                  onDateFieldChange={(filterId, value) => {
                    updateSearchState((current) => ({ ...current, [filterId]: value }));
                  }}
                  onLabelFilterQueryChange={setLabelFilterQuery}
                  onOpenDateFieldChange={(value) => {
                    setOpenDateField(value);
                    if (value) setOpenSection(null);
                  }}
                  onOpenSectionChange={(value) => {
                    setOpenSection(value);
                    setOpenDateField(null);
                  }}
                  openDateField={openDateField}
                  openSection={openSection}
                  updateSearchState={updateSearchState}
                  userLabels={labelsQuery.isPending ? [] : userLabels}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <Button onClick={() => void onScrollToTop()} size="icon-sm" type="button" variant="outline">
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </Button>
      </div>
    </div>
  );
};
