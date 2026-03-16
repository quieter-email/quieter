"use client";

import { ArrowUp01Icon, Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Field, Input } from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import { SpinWhileActive } from "../spin-while-active";
import { MessageListSearchDropdown } from "./message-list-search-dropdown";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
  removeLastStructuredSearchChip,
  removeUserLabelSelection,
  SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID,
  serializeStructuredSearchQuery,
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

const SearchFilterChip = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <motion.span
    animate={{ opacity: 1 }}
    className="inline-flex max-w-full items-center gap-1 rounded-md border border-input px-1.5 py-0.5 text-xs text-foreground"
    exit={{ opacity: 0 }}
    initial={{ opacity: 0 }}
    transition={{ opacity: { duration: 0.12, ease: "easeOut" } }}
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
      ×
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
  const [openSection, setOpenSection] = useState<SearchDropdownSectionId | null>(null);

  const labelsQuery = useQuery(labelsQueryOptions(isDropdownOpen));
  const userLabels = useMemo(() => getUserLabels(labelsQuery.data ?? []), [labelsQuery.data]);

  useEffect(() => {
    setDraftSearchState(parseStructuredSearchQuery(searchQuery));
  }, [searchQuery]);

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
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

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      closeDropdown();
    };

    const handleFocusInOutside = (event: FocusEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      closeDropdown();
    };

    document.addEventListener("pointerdown", handlePointerDownOutside);
    document.addEventListener("focusin", handleFocusInOutside);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
      document.removeEventListener("focusin", handleFocusInOutside);
    };
  }, [closeDropdown, isDropdownOpen]);

  return (
    <div className="border-b border-border bg-background-light px-4 py-3" role="search">
      <div ref={containerRef} className="space-y-2">
        {/* ── Row 1: Refresh + Search input + Scroll-to-top ── */}
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

          <Field className="min-w-0 flex-1">
            <div
              className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
              onPointerDown={(event) => {
                if (!(event.target instanceof Element)) return;
                if (event.target.closest("button, input")) return;
                setIsDropdownOpen(true);
                searchInputRef.current?.focus();
              }}
            >
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
                placeholder="Search"
                ref={searchInputRef}
                size="sm"
                spellCheck={false}
                type="search"
                value={draftSearchState.text}
              />

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
            </div>
          </Field>

          <Button
            onClick={() => void onScrollToTop()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </Button>
        </div>

        {/* ── Row 2: Active filter pills ── */}
        <AnimatePresence initial={false}>
          {selectedSearchChips.length > 0 ? (
            <motion.div
              key="filter-pills"
              animate={{ opacity: 1, height: "auto" }}
              className="flex flex-wrap gap-1.5 overflow-hidden"
              exit={{ opacity: 0, height: 0 }}
              initial={{ opacity: 0, height: 0 }}
              transition={{
                opacity: { duration: 0.14, ease: "easeOut" },
                height: { duration: 0.18, ease: "easeOut" },
              }}
            >
              <AnimatePresence initial={false}>
                {selectedSearchChips.map((chip) => (
                  <SearchFilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
                ))}
              </AnimatePresence>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ── Dropdown ── */}
        <AnimatePresence initial={false}>
          {isDropdownOpen ? (
            <motion.div
              key="message-list-search-dropdown"
              animate={{ opacity: 1, y: 0 }}
              className="overflow-hidden rounded-lg border border-border bg-popover p-2 shadow-lg"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: -4 }}
              transition={{
                opacity: { duration: 0.14, ease: "easeOut" },
                y: { duration: 0.14, ease: "easeOut" },
              }}
            >
              <MessageListSearchDropdown
                draftSearchState={draftSearchState}
                labelsErrorMessage={
                  labelsQuery.isPending ? null : (labelsQuery.error?.message ?? null)
                }
                onOpenSectionChange={(value) => {
                  setOpenSection(value);
                }}
                openSection={openSection}
                updateSearchState={updateSearchState}
                userLabels={labelsQuery.isPending ? [] : userLabels}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};
