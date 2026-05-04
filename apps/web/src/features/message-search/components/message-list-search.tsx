"use client";

import { Refresh01Icon, Search01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Calendar, IconButtonTooltip, cn } from "@quieter/ui";
import { useQuery } from "@tanstack/react-query";
import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowInteractionButton } from "~/components/arrow-interaction-button";
import { SpinWhileActive } from "~/components/spin-while-active";
import {
  getUserLabels,
  normalizeSearchText,
  normalizeLabelSelectionKey,
  parseStructuredSearchFilterToken,
  parseStructuredSearchQuery,
  serializeStructuredSearchFilterToken,
  type SearchFieldFilterType,
  type SearchFilterChip,
  type StructuredSearchState,
} from "~/features/message-search/state/message-list-search-state";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import { MessageListSearchDropdown, searchFilterOptions } from "./message-list-search-dropdown";

type MessageListSearchProps = {
  isRefreshing: boolean;
  mailboxId: string;
  onRefresh: () => void | Promise<void>;
  onOpenSidebar?: () => void;
  onScrollToTop: () => boolean | Promise<boolean> | void | Promise<void>;
  onSearch: (query: string) => void;
  searchQuery: string;
};

type PendingFocusTarget =
  | { kind: "segment"; index: number; selectAll?: boolean; toEnd?: boolean }
  | { kind: "text"; toEnd?: boolean };
type DropdownDirection = "next" | "previous";

const formatDateFilterValue = (date: Date) =>
  `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

const parseDateFilterValue = (value: string) => {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
};

const serializeStructuredSearchState = (state: StructuredSearchState) =>
  [...state.filters.map(serializeStructuredSearchFilterToken), normalizeSearchText(state.text)]
    .filter(Boolean)
    .join(" ")
    .trim();

const filterChipClassName =
  "squircle inline-flex h-6 shrink-0 items-center border border-border/80 bg-muted/80 text-[13px] text-foreground";

const getDropdownDirection = (key: string): DropdownDirection | null =>
  key === "ArrowDown" ? "next" : key === "ArrowUp" ? "previous" : null;

const isDateFilter = ({ type }: SearchFilterChip) => type === "after" || type === "before";

const isCaretAtStart = (input: HTMLInputElement) =>
  input.selectionStart === 0 && input.selectionEnd === 0;

const isCaretAtEnd = (input: HTMLInputElement) =>
  input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

const findLabelFilterIndex = (filters: readonly SearchFilterChip[], labelName: string) => {
  const labelKey = normalizeLabelSelectionKey(labelName);
  return filters.findIndex(
    (filter) => filter.type === "label" && normalizeLabelSelectionKey(filter.value) === labelKey,
  );
};

const upsertFilter = (filters: readonly SearchFilterChip[], nextFilter: SearchFilterChip) => {
  if (nextFilter.type === "label") {
    const existingIndex = findLabelFilterIndex(filters, nextFilter.value);
    if (existingIndex !== -1) {
      return { filters: [...filters], index: existingIndex };
    }

    return { filters: [...filters, nextFilter], index: filters.length };
  }

  const existingIndex = filters.findIndex((filter) => filter.type === nextFilter.type);
  if (existingIndex === -1) {
    return { filters: [...filters, nextFilter], index: filters.length };
  }

  const nextFilters = [...filters];
  nextFilters[existingIndex] = nextFilter;
  return { filters: nextFilters, index: existingIndex };
};

export const MessageListSearch = ({
  isRefreshing,
  mailboxId,
  onOpenSidebar,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const fieldRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const segmentRefs = useRef<Array<HTMLElement | null>>([]);
  const dateTokenRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingFocusRef = useRef<PendingFocusTarget | null>(null);
  const latestCommittedSearchQueryRef = useRef(searchQuery.trim());
  const selfPublishedSearchQueriesRef = useRef(new Set<string>());
  const [draftState, setDraftState] = useState<StructuredSearchState | null>(null);
  const [activeDateFilterIndex, setActiveDateFilterIndex] = useState<number | null>(null);
  const [activeDropdownIndex, setActiveDropdownIndex] = useState<number | null>(null);
  const [datePopoverLeft, setDatePopoverLeft] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const committedState = parseStructuredSearchQuery(searchQuery);
  const currentState = draftState ?? committedState;
  const labelsQuery = useQuery(labelsQueryOptions(mailboxId, isDropdownOpen));
  const userLabels = getUserLabels(labelsQuery.data ?? []);
  const activeDateFilter =
    activeDateFilterIndex === null ? null : (currentState.filters[activeDateFilterIndex] ?? null);

  const openDropdown = (preserveHighlight = false) => {
    if (!preserveHighlight) {
      setActiveDropdownIndex(null);
    }
    setIsDropdownOpen(true);
  };

  const closeDropdown = () => {
    setActiveDropdownIndex(null);
    setIsDropdownOpen(false);
  };

  const closeSearchOverlays = () => {
    closeDropdown();
    setActiveDateFilterIndex(null);
  };

  const openSearchDropdown = () => {
    setActiveDateFilterIndex(null);
    openDropdown();
  };

  const openDateFilter = (index: number) => {
    setActiveDateFilterIndex(index);
    closeDropdown();
  };

  const isSearchSurfaceTarget = (target: EventTarget | null) =>
    target instanceof Node &&
    ((fieldRef.current?.contains(target) ?? false) ||
      (target instanceof Element && !!target.closest("[data-search-dropdown-content]")));

  const handleSearchFieldBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (isSearchSurfaceTarget(event.relatedTarget)) {
      return;
    }

    requestAnimationFrame(() => {
      if (isSearchSurfaceTarget(document.activeElement)) {
        return;
      }

      commitState(currentState, true);
    });
  };

  const publishSearchQuery = (
    nextQuery: string,
    { refreshIfUnchanged = false }: { refreshIfUnchanged?: boolean } = {},
  ) => {
    if (nextQuery === latestCommittedSearchQueryRef.current && !refreshIfUnchanged) {
      return;
    }

    if (nextQuery !== latestCommittedSearchQueryRef.current) {
      selfPublishedSearchQueriesRef.current.add(nextQuery);
    }
    void onScrollToTop();
    onSearch(nextQuery);
  };

  const stageState = (nextState: StructuredSearchState) => {
    setDraftState(nextState);
  };

  const updateFilterValue = (index: number, value: string) => {
    stageState({
      ...currentState,
      filters: currentState.filters.map((filter, filterIndex) =>
        filterIndex === index ? { ...filter, value } : filter,
      ),
    });
  };

  const setSegmentRef = (index: number, node: HTMLElement | null) => {
    segmentRefs.current[index] = node;
  };

  const setDateTokenRef = (index: number, node: HTMLDivElement | null) => {
    if (node) {
      dateTokenRefs.current.set(index, node);
    } else {
      dateTokenRefs.current.delete(index);
    }
  };

  const focusTextInput = ({ toEnd = false }: { toEnd?: boolean } = {}) => {
    requestAnimationFrame(() => {
      const input = textInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      if (toEnd) {
        const position = input.value.length;
        input.setSelectionRange(position, position);
      }

      rowRef.current?.scrollTo({ left: rowRef.current.scrollWidth });
    });
  };

  const focusSegment = (
    index: number,
    { selectAll = false, toEnd = false }: { selectAll?: boolean; toEnd?: boolean } = {},
  ) => {
    requestAnimationFrame(() => {
      const segment = segmentRefs.current[index];
      if (!segment) {
        return;
      }

      segment.focus();
      if (segment instanceof HTMLInputElement) {
        if (selectAll) {
          segment.select();
        } else if (toEnd) {
          const position = segment.value.length;
          segment.setSelectionRange(position, position);
        }
      }

      segment.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const focusPreviousSegment = (index: number) => {
    if (index <= 0) {
      return;
    }

    const previousFilter = currentState.filters[index - 1];
    focusSegment(index - 1, {
      toEnd: previousFilter?.type !== "label",
    });
  };

  const focusNextSegment = (index: number) => {
    const nextFilter = currentState.filters[index + 1];
    if (!nextFilter) {
      focusTextInput({ toEnd: true });
      return;
    }

    focusSegment(index + 1);
  };

  const removeFilterAtIndex = (
    index: number,
    nextFocus: PendingFocusTarget = { kind: "text", toEnd: true },
  ) => {
    stageState({
      ...currentState,
      filters: currentState.filters.filter((_, filterIndex) => filterIndex !== index),
    });
    setActiveDateFilterIndex((currentIndex) => {
      if (currentIndex === null) {
        return null;
      }

      if (currentIndex === index) {
        return null;
      }

      return currentIndex > index ? currentIndex - 1 : currentIndex;
    });
    pendingFocusRef.current = nextFocus;
  };

  const commitState = (
    nextState: StructuredSearchState,
    closeAfterCommit = false,
    { refreshIfUnchanged = false }: { refreshIfUnchanged?: boolean } = {},
  ) => {
    const normalizedState = {
      filters: nextState.filters.filter((filter) => filter.value.trim().length > 0),
      text: normalizeSearchText(nextState.text),
    };

    const normalizedQuery = serializeStructuredSearchState(normalizedState);
    setDraftState(
      normalizedQuery === latestCommittedSearchQueryRef.current ? null : normalizedState,
    );
    publishSearchQuery(normalizedQuery, { refreshIfUnchanged });
    if (closeAfterCommit) {
      closeSearchOverlays();
    }
  };

  const handleFilterSelection = (type: SearchFieldFilterType) => {
    const { filters, index } = upsertFilter(currentState.filters, { type, value: "" });
    stageState({
      ...currentState,
      filters,
    });

    closeDropdown();
    setActiveDateFilterIndex(type === "after" || type === "before" ? index : null);
    pendingFocusRef.current = { index, kind: "segment", selectAll: true };
  };

  const toggleLabelToken = (labelName: string) => {
    const existingIndex = findLabelFilterIndex(currentState.filters, labelName);
    if (existingIndex === -1) {
      stageState({
        ...currentState,
        filters: [...currentState.filters, { type: "label", value: labelName }],
      });
      openDropdown(true);
      pendingFocusRef.current = { kind: "text", toEnd: true };
      return;
    }

    removeFilterAtIndex(existingIndex);
    openDropdown(true);
  };

  const dropdownItems = [
    ...searchFilterOptions.map((option) => ({
      key: `filter:${option.type}`,
      onSelect: () => handleFilterSelection(option.type),
    })),
    ...(labelsQuery.isPending || labelsQuery.error
      ? []
      : userLabels.map((label) => ({
          key: `label:${normalizeLabelSelectionKey(label.name)}`,
          onSelect: () => toggleLabelToken(label.name),
        }))),
  ];
  const highlightedDropdownItemKey =
    activeDropdownIndex === null ? null : (dropdownItems[activeDropdownIndex]?.key ?? null);

  const navigateDropdown = (direction: "next" | "previous") => {
    if (dropdownItems.length === 0) {
      return;
    }

    setActiveDropdownIndex((currentIndex) => {
      if (currentIndex === null) {
        return direction === "next" ? 0 : dropdownItems.length - 1;
      }

      return direction === "next"
        ? (currentIndex + 1) % dropdownItems.length
        : (currentIndex - 1 + dropdownItems.length) % dropdownItems.length;
    });
  };

  const handleDropdownNavigation = (direction: DropdownDirection) => {
    if (!isDropdownOpen) {
      openDropdown(true);
    }
    navigateDropdown(direction);
  };

  const activateHighlightedDropdownItem = () => {
    if (activeDropdownIndex === null) {
      return false;
    }

    const item = dropdownItems[activeDropdownIndex];
    if (!item) {
      return false;
    }

    item.onSelect();
    return true;
  };

  const moveOutOfSegment = (index: number, direction: "next" | "previous") => {
    if (direction === "previous" && index === 0) {
      return;
    }

    openSearchDropdown();
    if (direction === "previous") {
      focusPreviousSegment(index);
      return;
    }

    focusNextSegment(index);
  };

  const exitSegmentToTextInput = () => {
    openSearchDropdown();
    focusTextInput({ toEnd: true });
  };

  const commitOrActivateHighlightedDropdownItem = () => {
    if (!activateHighlightedDropdownItem()) {
      commitState(currentState, true, { refreshIfUnchanged: true });
    }
  };

  const handleDropdownKey = <T extends HTMLElement>(event: ReactKeyboardEvent<T>) => {
    const direction = getDropdownDirection(event.key);
    if (!direction) {
      return false;
    }

    event.preventDefault();
    handleDropdownNavigation(direction);
    return true;
  };

  const focusAfterRemovingFilter = (index: number): PendingFocusTarget =>
    index === 0
      ? { kind: "text", toEnd: true }
      : {
          index: index - 1,
          kind: "segment",
          toEnd: currentState.filters[index - 1]?.type !== "label",
        };

  const handleLabelTokenKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (handleDropdownKey(event)) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusPreviousSegment(index);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveOutOfSegment(index, "next");
      return;
    }

    if (
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      removeFilterAtIndex(index);
    }
  };

  const handleSegmentInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (getDropdownDirection(event.key)) {
      if (activeDateFilterIndex === null) {
        handleDropdownKey(event);
      }
      return;
    }

    if (event.key === "ArrowLeft" && isCaretAtStart(event.currentTarget)) {
      event.preventDefault();
      moveOutOfSegment(index, "previous");
      return;
    }

    if (event.key === "ArrowRight" && isCaretAtEnd(event.currentTarget)) {
      event.preventDefault();
      moveOutOfSegment(index, "next");
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      exitSegmentToTextInput();
      return;
    }

    if (event.key === "Backspace" && event.currentTarget.value.length === 0) {
      event.preventDefault();
      removeFilterAtIndex(index, focusAfterRemovingFilter(index));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitOrActivateHighlightedDropdownItem();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchOverlays();
    }
  };

  const handleTextInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === " " && handleTextInputSpace()) {
      event.preventDefault();
      return;
    }

    if (handleDropdownKey(event)) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitOrActivateHighlightedDropdownItem();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
      textInputRef.current?.blur();
      return;
    }

    if (
      event.key === "Backspace" &&
      currentState.text.length === 0 &&
      currentState.filters.length > 0
    ) {
      event.preventDefault();
      removeFilterAtIndex(currentState.filters.length - 1);
      return;
    }

    if (
      event.key === "ArrowLeft" &&
      isCaretAtStart(event.currentTarget) &&
      currentState.filters.length > 0
    ) {
      event.preventDefault();
      focusSegment(currentState.filters.length - 1, {
        toEnd: currentState.filters.at(-1)?.type !== "label",
      });
    }
  };

  const handleTextInputSpace = () => {
    const input = textInputRef.current;
    if (!input) {
      return false;
    }

    const selectionStart = input.selectionStart ?? currentState.text.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) {
      return false;
    }

    const tokenStart = currentState.text.lastIndexOf(" ", selectionStart - 1) + 1;
    const candidate = currentState.text.slice(tokenStart, selectionStart);
    const parsedToken = parseStructuredSearchFilterToken(candidate);
    if (!parsedToken) {
      return false;
    }

    const { filters, index } = upsertFilter(currentState.filters, parsedToken);
    stageState({
      filters,
      text: normalizeSearchText(
        `${currentState.text.slice(0, tokenStart)} ${currentState.text.slice(selectionStart)}`,
      ),
    });

    if (isDateFilter(parsedToken)) {
      openDateFilter(index);
      pendingFocusRef.current = { index, kind: "segment", selectAll: true };
      return true;
    }

    openSearchDropdown();
    pendingFocusRef.current =
      parsedToken.type === "label"
        ? { kind: "text", toEnd: true }
        : { index, kind: "segment", selectAll: true };
    return true;
  };

  useEffect(() => {
    const committedQuery = searchQuery.trim();
    const isSelfPublishedQuery = selfPublishedSearchQueriesRef.current.delete(committedQuery);
    latestCommittedSearchQueryRef.current = committedQuery;

    setDraftState((currentDraftState) => {
      if (!currentDraftState) {
        return null;
      }

      if (isSelfPublishedQuery) {
        return currentDraftState;
      }

      return null;
    });
  }, [searchQuery]);

  useEffect(() => {
    if (!isDropdownOpen && activeDateFilterIndex === null) {
      return;
    }

    const handleOutsideSearchEvent = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !isSearchSurfaceTarget(event.target)) {
        closeSearchOverlays();
      }
    };

    document.addEventListener("pointerdown", handleOutsideSearchEvent, true);
    document.addEventListener("focusin", handleOutsideSearchEvent, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsideSearchEvent, true);
      document.removeEventListener("focusin", handleOutsideSearchEvent, true);
    };
  }, [activeDateFilterIndex, isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen || activeDateFilterIndex !== null) {
      setActiveDropdownIndex(null);
      return;
    }

    if (activeDropdownIndex !== null && activeDropdownIndex >= dropdownItems.length) {
      setActiveDropdownIndex(dropdownItems.length > 0 ? dropdownItems.length - 1 : null);
    }
  }, [activeDateFilterIndex, activeDropdownIndex, dropdownItems.length, isDropdownOpen]);

  useLayoutEffect(() => {
    if (!pendingFocusRef.current) {
      return;
    }

    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (target.kind === "text") {
      focusTextInput({ toEnd: target.toEnd });
      return;
    }

    focusSegment(target.index, {
      selectAll: target.selectAll,
      toEnd: target.toEnd,
    });
  }, [currentState]);

  useLayoutEffect(() => {
    if (activeDateFilterIndex === null) {
      return;
    }

    const field = fieldRef.current;
    const token = dateTokenRefs.current.get(activeDateFilterIndex);
    if (!field || !token) {
      return;
    }

    const fieldRect = field.getBoundingClientRect();
    const tokenRect = token.getBoundingClientRect();
    const maxLeft = Math.max(field.clientWidth - 270, 0);
    setDatePopoverLeft(Math.max(0, Math.min(tokenRect.left - fieldRect.left, maxLeft)));
  }, [activeDateFilterIndex, currentState.filters]);

  return (
    <div className="bg-background-light px-4 py-3" role="search">
      <div className="relative">
        <div className="flex min-w-0 items-center gap-2">
          {onOpenSidebar && (
            <IconButtonTooltip label="Open sidebar">
              <Button
                aria-label="Open sidebar"
                className="lg:hidden"
                onClick={onOpenSidebar}
                size="icon-sm"
                variant="outline"
              >
                <HugeiconsIcon icon={SidebarLeftIcon} />
              </Button>
            </IconButtonTooltip>
          )}

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

          <div ref={fieldRef} className="relative min-w-0 flex-1" onBlur={handleSearchFieldBlur}>
            <div className="squircle flex h-8 min-w-0 items-center gap-1 rounded-md border border-input bg-background pr-1 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
              <div
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  {
                    "pl-[3px]": currentState.filters.length > 0,
                    "pl-2": currentState.filters.length === 0,
                  },
                )}
                onMouseDown={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("button, input")) {
                    return;
                  }

                  event.preventDefault();
                  openSearchDropdown();
                  focusTextInput({ toEnd: true });
                }}
                ref={rowRef}
                role="presentation"
              >
                {currentState.filters.map((filter, index) => {
                  if (filter.type === "label") {
                    return (
                      <button
                        className={cn(
                          filterChipClassName,
                          "squircle rounded-xs px-2 outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
                        )}
                        key={`label:${normalizeLabelSelectionKey(filter.value)}`}
                        onClick={() => removeFilterAtIndex(index)}
                        onFocus={openSearchDropdown}
                        onKeyDown={(event) => handleLabelTokenKeyDown(event, index)}
                        ref={(node) => setSegmentRef(index, node)}
                        type="button"
                      >
                        {filter.value}
                      </button>
                    );
                  }

                  const isCurrentFilterDate = isDateFilter(filter);
                  return (
                    <div
                      className={cn(
                        filterChipClassName,
                        "squircle gap-1 rounded-xs px-1.5 transition-colors",
                        {
                          "border-ring ring-2 ring-ring/20": activeDateFilterIndex === index,
                        },
                      )}
                      key={filter.type}
                      ref={(node) => setDateTokenRef(index, node)}
                    >
                      <span className="shrink-0 text-muted-foreground">{`${filter.type}:`}</span>
                      <input
                        aria-label={`${filter.type} filter value`}
                        autoCapitalize="off"
                        autoCorrect="off"
                        className={cn(
                          "field-sizing-content min-w-[1ch] bg-transparent text-foreground outline-none",
                          {
                            "mr-1": index === 0,
                            "mx-1": index > 0,
                            "placeholder:text-muted-foreground": isCurrentFilterDate,
                          },
                        )}
                        onChange={(event) => updateFilterValue(index, event.currentTarget.value)}
                        onFocus={() =>
                          isCurrentFilterDate ? openDateFilter(index) : openSearchDropdown()
                        }
                        onKeyDown={(event) => handleSegmentInputKeyDown(event, index)}
                        onMouseDown={() => isCurrentFilterDate && openDateFilter(index)}
                        placeholder={isCurrentFilterDate ? "YYYY/M/D" : ""}
                        ref={(node) => setSegmentRef(index, node)}
                        spellCheck={false}
                        type="text"
                        value={filter.value}
                      />
                    </div>
                  );
                })}

                <input
                  aria-label="Search"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="h-6 min-w-[8ch] flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  onChange={(event) => {
                    setActiveDropdownIndex(null);
                    stageState({
                      ...currentState,
                      text: event.currentTarget.value,
                    });
                  }}
                  onFocus={openSearchDropdown}
                  onKeyDown={handleTextInputKeyDown}
                  placeholder={currentState.filters.length > 0 ? "" : "Search"}
                  ref={textInputRef}
                  spellCheck={false}
                  type="text"
                  value={currentState.text}
                />
              </div>

              <IconButtonTooltip label="Run search">
                <Button
                  aria-label="Run search"
                  className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    commitState(currentState, true, { refreshIfUnchanged: true });
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

            {activeDateFilter &&
              activeDateFilterIndex !== null &&
              (activeDateFilter.type === "after" || activeDateFilter.type === "before") && (
                <div
                  className="absolute top-full z-40 mt-2 rounded-lg border bg-popover p-2 shadow-lg"
                  style={{ left: datePopoverLeft }}
                >
                  <Calendar
                    mode="single"
                    month={parseDateFilterValue(activeDateFilter.value) ?? new Date()}
                    onSelect={(date) => {
                      if (!date) {
                        return;
                      }

                      updateFilterValue(activeDateFilterIndex, formatDateFilterValue(date));
                      openSearchDropdown();
                      pendingFocusRef.current = { kind: "text", toEnd: true };
                    }}
                    selected={parseDateFilterValue(activeDateFilter.value)}
                  />
                </div>
              )}

            <MessageListSearchDropdown
              draftSearchState={currentState}
              highlightedItemKey={highlightedDropdownItemKey}
              isLoadingLabels={labelsQuery.isPending}
              isOpen={isDropdownOpen}
              labelsErrorMessage={
                labelsQuery.isPending ? null : (labelsQuery.error?.message ?? null)
              }
              onSelectFilter={handleFilterSelection}
              onToggleLabel={toggleLabelToken}
              userLabels={labelsQuery.isPending ? [] : userLabels}
            />
          </div>

          <IconButtonTooltip label="Scroll to top">
            <ArrowInteractionButton
              aria-label="Scroll to top"
              onClick={async () => {
                const didScroll = await onScrollToTop();
                return typeof didScroll === "boolean" ? didScroll : true;
              }}
              size="icon-sm"
              type="button"
              variant="outline"
            />
          </IconButtonTooltip>
        </div>
      </div>
    </div>
  );
};
