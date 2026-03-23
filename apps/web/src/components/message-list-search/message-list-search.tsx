"use client";

import { ArrowUp01Icon, Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Field, IconButtonTooltip, Input } from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
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
  mailboxId: string;
  onRefresh: () => void | Promise<void>;
  onScrollToTop: () => void | Promise<void>;
  onSearch: (query: string) => void;
  searchQuery: string;
};

const SearchFilterChip = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-input px-1.5 py-0.5 text-xs text-foreground">
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
  </span>
);

export const MessageListSearch = ({
  isRefreshing,
  mailboxId,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLElement>(null!);
  const openWithAnimationRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const [draftSearchState, setDraftSearchState] = useState<{
    baseQuery: string;
    value: StructuredSearchState;
  } | null>(null);
  const [animateDropdown, setAnimateDropdown] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [openSection, setOpenSection] = useState<SearchDropdownSectionId | null>(null);

  const labelsQuery = useQuery(labelsQueryOptions(mailboxId, isDropdownOpen));
  const committedSearchState = useMemo(
    () => parseStructuredSearchQuery(searchQuery),
    [searchQuery],
  );
  const currentSearchState =
    draftSearchState?.baseQuery === searchQuery ? draftSearchState.value : committedSearchState;
  const userLabels = useMemo(() => getUserLabels(labelsQuery.data ?? []), [labelsQuery.data]);

  const openDropdown = useCallback(() => {
    setAnimateDropdown(openWithAnimationRef.current);
    openWithAnimationRef.current = false;
    setIsDropdownOpen(true);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setAnimateDropdown(false);
    openWithAnimationRef.current = false;
    setOpenSection(null);
  }, []);

  const commitSearchState = useCallback(
    (nextState: StructuredSearchState, closeAfterCommit = false) => {
      setDraftSearchState({
        baseQuery: searchQuery,
        value: nextState,
      });
      void onScrollToTop();
      onSearch(serializeStructuredSearchQuery(nextState));
      if (closeAfterCommit) closeDropdown();
    },
    [closeDropdown, onScrollToTop, onSearch, searchQuery],
  );

  const updateSearchState = useCallback(
    (
      updater: StructuredSearchState | ((current: StructuredSearchState) => StructuredSearchState),
      closeAfterCommit = false,
    ) => {
      const nextState = typeof updater === "function" ? updater(currentSearchState) : updater;
      commitSearchState(nextState, closeAfterCommit);
    },
    [commitSearchState, currentSearchState],
  );

  const selectedSearchChips = useMemo(
    () => [
      ...(currentSearchState.categoryFilter
        ? [
            {
              key: `category:${currentSearchState.categoryFilter}`,
              label: SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID[currentSearchState.categoryFilter].label,
              onRemove: () =>
                updateSearchState((current) => ({ ...current, categoryFilter: null })),
            },
          ]
        : []),
      ...currentSearchState.userLabels.map((userLabel) => ({
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
    [currentSearchState, updateSearchState, userLabels],
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
    <LazyMotion features={domAnimation}>
      <div className="border-b border-border bg-background-light px-4 py-3" role="search">
        <div ref={containerRef} className="space-y-2">
          {/* ── Row 1: Refresh + Search input + Scroll-to-top ── */}
          <div className="flex items-center gap-2">
            <IconButtonTooltip label="Refresh list">
              <Button
                aria-label="Refresh list"
                disabled={isRefreshing}
                onClick={() => void onRefresh()}
                size="icon-sm"
                variant="outline"
              >
                <SpinWhileActive active={isRefreshing}>
                  <HugeiconsIcon icon={Refresh01Icon} />
                </SpinWhileActive>
              </Button>
            </IconButtonTooltip>

            <Field className="min-w-0 flex-1">
              <div
                className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
                onPointerDownCapture={(event) => {
                  if (event.pointerType) {
                    openWithAnimationRef.current = true;
                  }
                }}
                onPointerDown={(event) => {
                  if (!(event.target instanceof Element)) return;
                  if (event.target.closest("button, input")) return;
                  openDropdown();
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
                    setDraftSearchState({
                      baseQuery: searchQuery,
                      value: {
                        ...currentSearchState,
                        text: event.currentTarget.value,
                      },
                    });
                  }}
                  onFocus={() => openDropdown()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitSearchState(currentSearchState, true);
                      return;
                    }
                    if (event.key === "Escape") {
                      closeDropdown();
                      event.currentTarget.blur();
                      return;
                    }
                    if (event.key === "Backspace" && currentSearchState.text.length === 0) {
                      event.preventDefault();
                      updateSearchState(removeLastStructuredSearchChip(currentSearchState));
                    }
                  }}
                  placeholder="Search"
                  ref={searchInputRef}
                  size="sm"
                  spellCheck={false}
                  type="search"
                  value={currentSearchState.text}
                />

                <IconButtonTooltip label="Run search">
                  <Button
                    aria-label="Run search"
                    className="h-6 w-6 shrink-0 self-center text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      commitSearchState(currentSearchState, true);
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
                </IconButtonTooltip>
              </div>
            </Field>

            <IconButtonTooltip label="Scroll to top">
              <Button
                aria-label="Scroll to top"
                onClick={() => void onScrollToTop()}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} />
              </Button>
            </IconButtonTooltip>
          </div>

          {/* ── Row 2: Active filter pills ── */}
          {selectedSearchChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 overflow-hidden">
              {selectedSearchChips.map((chip) => (
                <SearchFilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
              ))}
            </div>
          ) : null}

          {/* ── Dropdown ── */}
          <AnimatePresence initial={false}>
            {isDropdownOpen ? (
              <m.div
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                className="overflow-hidden rounded-lg border border-border bg-popover p-2 shadow-lg"
                exit={{
                  opacity: 0,
                  transform:
                    animateDropdown && !prefersReducedMotion
                      ? "translateY(-4px)"
                      : "translateY(0px)",
                }}
                initial={{
                  opacity: animateDropdown && !prefersReducedMotion ? 0 : 1,
                  transform:
                    animateDropdown && !prefersReducedMotion
                      ? "translateY(-4px)"
                      : "translateY(0px)",
                }}
                transition={
                  animateDropdown && !prefersReducedMotion
                    ? {
                        opacity: { duration: 0.14, ease: "easeOut" },
                        transform: { duration: 0.14, ease: "easeOut" },
                      }
                    : { duration: 0 }
                }
              >
                <MessageListSearchDropdown
                  draftSearchState={currentSearchState}
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
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </LazyMotion>
  );
};
