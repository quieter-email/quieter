"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getUserLabels,
  normalizeSearchText,
  normalizeLabelSelectionKey,
  parseStructuredSearchFilterToken,
  parseStructuredSearchQuery,
  type SearchFilterChip,
  type StructuredSearchState,
} from "~/features/message-search/state/message-list-search-state";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import { searchFilterOptions } from "../message-list-search-dropdown";
import {
  type DropdownDirection,
  type MessageListSearchProps,
  type PendingFocusTarget,
  type SearchOverlayState,
} from "./message-list-search-types";
import {
  findLabelFilterIndex,
  formatDateFilterValue,
  getCalendarFallbackMonth,
  getDropdownDirection,
  getServerCalendarFallbackMonth,
  isCaretAtEnd,
  isCaretAtStart,
  isDateFilter,
  isFixedValueFilter,
  serializeStructuredSearchState,
  shouldFocusFilterValueEnd,
  subscribeToCalendarFallbackMonth,
  upsertFilter,
} from "./message-list-search-utils";

const initialSearchOverlayState: SearchOverlayState = {
  activeDateFilterIndex: null,
  activeDropdownIndex: null,
  datePopoverLeft: 0,
  isDropdownOpen: false,
};

const resolveStateAction = <T>(action: SetStateAction<T>, current: T) =>
  typeof action === "function" ? (action as (current: T) => T)(current) : action;

export const useMessageListSearchController = ({
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
  const calendarFallbackMonth = useSyncExternalStore(
    subscribeToCalendarFallbackMonth,
    getCalendarFallbackMonth,
    getServerCalendarFallbackMonth,
  );
  const [searchOverlay, setSearchOverlay] = useState<SearchOverlayState>(initialSearchOverlayState);
  const { activeDateFilterIndex, activeDropdownIndex, datePopoverLeft, isDropdownOpen } =
    searchOverlay;

  const setActiveDateFilterIndex = (action: SetStateAction<number | null>) => {
    setSearchOverlay((current) => ({
      ...current,
      activeDateFilterIndex: resolveStateAction(action, current.activeDateFilterIndex),
    }));
  };

  const setActiveDropdownIndex = (action: SetStateAction<number | null>) => {
    setSearchOverlay((current) => ({
      ...current,
      activeDropdownIndex: resolveStateAction(action, current.activeDropdownIndex),
    }));
  };

  const setDatePopoverLeft = (action: SetStateAction<number>) => {
    setSearchOverlay((current) => ({
      ...current,
      datePopoverLeft: resolveStateAction(action, current.datePopoverLeft),
    }));
  };

  const setIsDropdownOpen = (action: SetStateAction<boolean>) => {
    setSearchOverlay((current) => ({
      ...current,
      isDropdownOpen: resolveStateAction(action, current.isDropdownOpen),
    }));
  };

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

  const updateSearchText = (value: string) => {
    setActiveDropdownIndex(null);
    stageState({
      ...currentState,
      text: value,
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
      toEnd: shouldFocusFilterValueEnd(previousFilter),
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

  const handleFilterSelection = (filter: SearchFilterChip) => {
    const { filters, index } = upsertFilter(currentState.filters, filter);
    stageState({
      ...currentState,
      filters,
    });

    if (isFixedValueFilter(filter)) {
      openDropdown(true);
      pendingFocusRef.current = { kind: "text", toEnd: true };
      return;
    }

    closeDropdown();
    setActiveDateFilterIndex(isDateFilter(filter) ? index : null);
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
      key: `filter:${option.filter.type}:${option.filter.value}`,
      onSelect: () => handleFilterSelection(option.filter),
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
          toEnd: shouldFocusFilterValueEnd(currentState.filters[index - 1]),
        };

  const handleTokenKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    { removeOnSpace = false }: { removeOnSpace?: boolean } = {},
  ) => {
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
      (removeOnSpace && event.key === " ")
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
        toEnd: shouldFocusFilterValueEnd(currentState.filters.at(-1)),
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
      parsedToken.type === "label" || isFixedValueFilter(parsedToken)
        ? { kind: "text", toEnd: true }
        : { index, kind: "segment", selectAll: true };
    return true;
  };

  const clearSearch = () => {
    commitState({ filters: [], text: "" }, true);
    focusTextInput({ toEnd: true });
  };

  const runSearch = () => {
    commitState(currentState, true, { refreshIfUnchanged: true });
  };

  const selectDateFilterValue = (date: Date) => {
    if (activeDateFilterIndex === null) {
      return;
    }

    updateFilterValue(activeDateFilterIndex, formatDateFilterValue(date));
    openSearchDropdown();
    pendingFocusRef.current = { kind: "text", toEnd: true };
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

  return {
    activeDateFilter,
    activeDateFilterIndex,
    calendarFallbackMonth,
    clearSearch,
    currentState,
    datePopoverLeft,
    fieldRef,
    focusTextInput,
    handleFilterSelection,
    handleSearchFieldBlur,
    handleSegmentInputKeyDown,
    handleTextInputKeyDown,
    handleTokenKeyDown,
    highlightedDropdownItemKey,
    isDropdownOpen,
    isLoadingLabels: labelsQuery.isPending,
    isRefreshing,
    labelsErrorMessage: labelsQuery.isPending ? null : (labelsQuery.error?.message ?? null),
    onOpenSidebar,
    onRefresh,
    onScrollToTop,
    openDateFilter,
    openSearchDropdown,
    removeFilterAtIndex,
    rowRef,
    runSearch,
    selectDateFilterValue,
    setDateTokenRef,
    setSegmentRef,
    textInputRef,
    toggleLabelToken,
    updateFilterValue,
    updateSearchText,
    userLabels: labelsQuery.isPending ? [] : userLabels,
  };
};

export type MessageListSearchController = ReturnType<typeof useMessageListSearchController>;
