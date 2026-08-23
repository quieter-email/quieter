"use client";

import { parseNaturalLanguageMailSearch } from "@quieter/mail/natural-language-search";
import {
  getSupportedMailSearchFilterTypes,
  isMailSearchFilterSupported,
} from "@quieter/mail/search";
import { toast } from "@quieter/ui/toast";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  SetStateAction,
} from "react";

import { shouldIgnoreAppShortcut } from "#/features/hotkeys/domain/hotkey-guards";
import {
  getUserLabels,
  normalizeSearchText,
  normalizeLabelSelectionKey,
  parseStructuredSearchFilterToken,
  parseStructuredSearchQuery,
} from "#/features/message-search/state/message-list-search-state";
import type {
  SearchFilterChip,
  StructuredSearchState,
} from "#/features/message-search/state/message-list-search-state";
import { USER_BILLING_QUERY_KEY } from "#/features/settings/domain/billing";
import { toastError } from "#/lib/error-toast";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import { orpc } from "#/lib/orpc";

import { searchFilterOptions } from "../message-list-search-filter-options";
import type {
  DropdownDirection,
  MessageListSearchProps,
  PendingFocusTarget,
  SearchOverlayState,
} from "./message-list-search-types";
import {
  cycleSearchFilter,
  findLabelFilterIndex,
  formatDateFilterValue,
  getCalendarFallbackMonth,
  getDropdownDirection,
  getServerCalendarFallbackMonth,
  isCaretAtEnd,
  isCaretAtStart,
  isDateFilter,
  isFixedValueFilter,
  mergeInterpretedFilters,
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

const isAvailableFilterOption = (
  option: (typeof searchFilterOptions)[number],
  supportedFilterTypes: ReadonlySet<string>,
  mailboxProvider: MessageListSearchProps["mailboxProvider"]
) =>
  supportedFilterTypes.has(option.filter.type) &&
  !(
    mailboxProvider === "gmail" &&
    option.filter.type === "is" &&
    ["inbound", "outbound"].includes(option.filter.value)
  );

const getActiveDraftState = (
  draftState: DraftSearchState | null,
  committedSearchQuery: string,
  serializedDraftState: string | null
) => {
  if (draftState === null) {
    return null;
  }
  if (
    draftState.baseQuery === committedSearchQuery ||
    serializedDraftState === committedSearchQuery
  ) {
    return draftState.state;
  }
  return null;
};

type DraftSearchState = {
  baseQuery: string;
  state: StructuredSearchState;
};

const isStateUpdater = <T>(
  action: SetStateAction<T>
): action is (current: T) => T => typeof action === "function";

const resolveStateAction = <T>(action: SetStateAction<T>, current: T) => {
  if (isStateUpdater(action)) {
    return action(current);
  }
  return action;
};

export const useMessageListSearchController = ({
  isRefreshing,
  mailboxId,
  mailboxProvider,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const fieldRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const segmentRefs = useRef<(HTMLElement | null)[]>([]);
  const dateTokenRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingFocusRef = useRef<PendingFocusTarget | null>(null);
  const suppressNextBlurCommitRef = useRef(false);
  const [textInputIndex, setTextInputIndex] = useState<number | null>(null);
  const committedSearchQuery = searchQuery.trim();
  const [draftState, setDraftState] = useState<DraftSearchState | null>(null);
  const calendarFallbackMonth = useSyncExternalStore(
    subscribeToCalendarFallbackMonth,
    getCalendarFallbackMonth,
    getServerCalendarFallbackMonth
  );
  const [searchOverlay, setSearchOverlay] = useState<SearchOverlayState>(
    initialSearchOverlayState
  );
  const {
    activeDateFilterIndex,
    activeDropdownIndex,
    datePopoverLeft,
    isDropdownOpen,
  } = searchOverlay;

  const setActiveDateFilterIndex = (action: SetStateAction<number | null>) => {
    setSearchOverlay((current) => ({
      ...current,
      activeDateFilterIndex: resolveStateAction(
        action,
        current.activeDateFilterIndex
      ),
    }));
  };

  const setActiveDropdownIndex = (action: SetStateAction<number | null>) => {
    setSearchOverlay((current) => ({
      ...current,
      activeDropdownIndex: resolveStateAction(
        action,
        current.activeDropdownIndex
      ),
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

  const committedState = parseStructuredSearchQuery(committedSearchQuery);
  const serializedDraftState = draftState
    ? serializeStructuredSearchState(draftState.state)
    : null;
  const activeDraftState = getActiveDraftState(
    draftState,
    committedSearchQuery,
    serializedDraftState
  );
  const currentState = activeDraftState ?? committedState;
  const currentTextInputIndex = Math.min(
    textInputIndex ?? currentState.filters.length,
    currentState.filters.length
  );
  const {
    data: labelsData,
    error: labelsError,
    isPending: isLabelsPending,
  } = useQuery(labelsQueryOptions(mailboxId, isDropdownOpen));
  const userLabels = getUserLabels(labelsData ?? []);
  const activeDateFilter =
    activeDateFilterIndex === null
      ? null
      : (currentState.filters[activeDateFilterIndex] ?? null);
  const supportedFilterTypes =
    getSupportedMailSearchFilterTypes(mailboxProvider);
  const availableFilterOptions = searchFilterOptions.filter((option) =>
    isAvailableFilterOption(option, supportedFilterTypes, mailboxProvider)
  );

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

  const dismissSearch = () => {
    closeSearchOverlays();
    textInputRef.current?.blur();
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
      (target instanceof Element &&
        !!target.closest("[data-search-dropdown-content]")));

  const handleSearchFieldBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (isSearchSurfaceTarget(event.relatedTarget)) {
      return;
    }

    requestAnimationFrame(() => {
      if (suppressNextBlurCommitRef.current) {
        suppressNextBlurCommitRef.current = false;
        return;
      }
      if (isSearchSurfaceTarget(document.activeElement)) {
        return;
      }

      commitState(currentState, true);
    });
  };

  const publishSearchQuery = (
    nextQuery: string,
    { refreshIfUnchanged = false }: { refreshIfUnchanged?: boolean } = {}
  ) => {
    if (nextQuery === committedSearchQuery && !refreshIfUnchanged) {
      return;
    }

    void onScrollToTop();
    onSearch(nextQuery);
  };

  const stageState = (nextState: StructuredSearchState) => {
    setDraftState({
      baseQuery: committedSearchQuery,
      state: nextState,
    });
  };

  const updateFilterValue = (index: number, value: string) => {
    stageState({
      ...currentState,
      filters: currentState.filters.map((filter, filterIndex) =>
        filterIndex === index ? { ...filter, value } : filter
      ),
    });
  };

  const updateSearchText = (value: string) => {
    setActiveDropdownIndex(null);
    stageState({
      ...currentState,
      text: value,
    });
    if (value.length > 0) {
      closeDropdown();
    } else if (currentState.text.length > 0) {
      openDropdown(true);
    }
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

  const focusTextInput = useCallback(
    ({
      index = currentState.filters.length,
      toEnd = false,
    }: { index?: number; toEnd?: boolean } = {}) => {
      setTextInputIndex(
        Math.max(0, Math.min(index, currentState.filters.length))
      );
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
        input.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [currentState.filters.length]
  );

  const blurSearchField = () => {
    const { activeElement } = document;
    if (
      activeElement instanceof HTMLElement &&
      fieldRef.current !== null &&
      fieldRef.current.contains(activeElement)
    ) {
      activeElement.blur();
    }
  };

  const focusSegment = (
    index: number,
    {
      selectAll = false,
      toEnd = false,
    }: { selectAll?: boolean; toEnd?: boolean } = {}
  ) => {
    requestAnimationFrame(() => {
      const segment = segmentRefs.current[index];
      if (!segment) {
        return;
      }

      segment.focus();
      segment.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (segment instanceof HTMLInputElement) {
        if (selectAll) {
          segment.select();
        } else if (toEnd) {
          const position = segment.value.length;
          segment.setSelectionRange(position, position);
        }
      }
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
    if (nextFilter === undefined) {
      focusTextInput({ toEnd: true });
      return;
    }

    focusSegment(index + 1);
  };

  const insertFilterAtTextInput = (filter: SearchFilterChip) => {
    const { filters, index } = upsertFilter(currentState.filters, filter);
    if (index !== currentState.filters.length) {
      return { filters, index };
    }

    const appendedFilter = filters.at(-1);
    if (!appendedFilter) {
      return { filters, index };
    }

    return {
      filters: [
        ...filters.slice(0, currentTextInputIndex),
        appendedFilter,
        ...filters.slice(currentTextInputIndex, -1),
      ],
      index: currentTextInputIndex,
    };
  };

  const removeFilterAtIndex = (
    index: number,
    nextFocus?: PendingFocusTarget
  ) => {
    stageState({
      ...currentState,
      filters: currentState.filters.filter(
        (_, filterIndex) => filterIndex !== index
      ),
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
    pendingFocusRef.current = nextFocus ?? { kind: "text", toEnd: true };
  };

  const commitState = (
    nextState: StructuredSearchState,
    closeAfterCommit = false,
    { refreshIfUnchanged = false }: { refreshIfUnchanged?: boolean } = {}
  ) => {
    const normalizedState = {
      filters: nextState.filters.filter(
        (filter) =>
          filter.value.trim().length > 0 &&
          isMailSearchFilterSupported(mailboxProvider, filter)
      ),
      text: normalizeSearchText(nextState.text),
    };

    const normalizedQuery = serializeStructuredSearchState(normalizedState);
    setDraftState(
      normalizedQuery === searchQuery
        ? null
        : {
            baseQuery: normalizedQuery,
            state: normalizedState,
          }
    );
    publishSearchQuery(normalizedQuery, { refreshIfUnchanged });
    if (closeAfterCommit) {
      closeSearchOverlays();
    }
  };

  const cycleFilterFromPointer = (index: number) => {
    pendingFocusRef.current = null;
    setActiveDateFilterIndex(null);
    commitState(
      {
        ...currentState,
        filters: cycleSearchFilter(currentState.filters, index),
      },
      true
    );
    suppressNextBlurCommit();
    blurSearchField();
  };

  const removeFilterFromPointer = (index: number) => {
    pendingFocusRef.current = null;
    setActiveDateFilterIndex(null);
    commitState(
      {
        ...currentState,
        filters: currentState.filters.filter(
          (_, filterIndex) => filterIndex !== index
        ),
      },
      true
    );
    suppressNextBlurCommit();
    blurSearchField();
  };

  const suppressNextBlurCommit = () => {
    suppressNextBlurCommitRef.current = true;
  };

  const handleFilterSelection = (filter: SearchFilterChip) => {
    const existingIndex = currentState.filters.findIndex(
      (existingFilter) =>
        existingFilter.type === filter.type &&
        existingFilter.value === filter.value
    );
    if (isFixedValueFilter(filter) && existingIndex !== -1) {
      stageState({
        ...currentState,
        filters: cycleSearchFilter(currentState.filters, existingIndex),
      });
      openDropdown(true);
      pendingFocusRef.current = { kind: "text", toEnd: true };
      return;
    }

    const { filters, index } = insertFilterAtTextInput(filter);
    stageState({
      ...currentState,
      filters,
    });

    if (isFixedValueFilter(filter)) {
      openDropdown(true);
      pendingFocusRef.current = { index: index + 1, kind: "text", toEnd: true };
      return;
    }

    closeDropdown();
    setActiveDateFilterIndex(isDateFilter(filter) ? index : null);
    pendingFocusRef.current = { index, kind: "segment", selectAll: true };
  };

  const toggleLabelToken = (labelName: string) => {
    const existingIndex = findLabelFilterIndex(currentState.filters, labelName);
    if (existingIndex === -1) {
      const { filters, index } = insertFilterAtTextInput({
        type: "label",
        value: labelName,
      });
      stageState({
        ...currentState,
        filters,
      });
      openDropdown(true);
      pendingFocusRef.current = { index: index + 1, kind: "text", toEnd: true };
      return;
    }

    stageState({
      ...currentState,
      filters: cycleSearchFilter(currentState.filters, existingIndex),
    });
    pendingFocusRef.current = { kind: "text", toEnd: true };
    openDropdown(true);
  };

  const dropdownItems = [
    ...availableFilterOptions.map((option) => ({
      key: `filter:${option.filter.type}:${option.filter.value}`,
      onSelect: () => {
        handleFilterSelection(option.filter);
      },
    })),
    ...(isLabelsPending || labelsError
      ? []
      : userLabels.map((label) => ({
          key: `label:${normalizeLabelSelectionKey(label.name)}`,
          onSelect: () => {
            toggleLabelToken(label.name);
          },
        }))),
  ];
  const highlightedDropdownItemKey =
    !isDropdownOpen ||
    activeDateFilterIndex !== null ||
    activeDropdownIndex === null
      ? null
      : (dropdownItems[
          activeDropdownIndex >= dropdownItems.length
            ? dropdownItems.length - 1
            : activeDropdownIndex
        ]?.key ?? null);

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

    const item =
      dropdownItems[
        activeDropdownIndex >= dropdownItems.length
          ? dropdownItems.length - 1
          : activeDropdownIndex
      ];
    if (item === undefined) {
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

  const handleDropdownKey = <T extends HTMLElement>(
    event: ReactKeyboardEvent<T>
  ) => {
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
    index: number
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

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      removeFilterAtIndex(index);
    }
  };

  const handleSegmentInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    index: number
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

  const handleTextInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === " " && handleTextInputSpace()) {
      event.preventDefault();
      return;
    }

    if (handleDropdownKey(event)) {
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      interpretNaturalLanguage();
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
      currentTextInputIndex > 0
    ) {
      event.preventDefault();
      removeFilterAtIndex(currentTextInputIndex - 1, {
        index: currentTextInputIndex - 1,
        kind: "text",
        toEnd: true,
      });
      return;
    }

    if (event.key === "ArrowLeft" && isCaretAtStart(event.currentTarget)) {
      const previousIndex = currentTextInputIndex - 1;
      const previousFilter = currentState.filters[previousIndex];
      if (previousFilter === undefined) {
        return;
      }

      event.preventDefault();
      if (shouldFocusFilterValueEnd(previousFilter)) {
        focusSegment(previousIndex, { toEnd: true });
      } else {
        focusTextInput({ index: previousIndex });
      }
      return;
    }

    if (event.key === "ArrowRight" && isCaretAtEnd(event.currentTarget)) {
      const nextFilter = currentState.filters[currentTextInputIndex];
      if (nextFilter === undefined) {
        return;
      }

      event.preventDefault();
      if (shouldFocusFilterValueEnd(nextFilter)) {
        focusSegment(currentTextInputIndex);
      } else {
        focusTextInput({ index: currentTextInputIndex + 1 });
      }
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

    const tokenStart =
      currentState.text.lastIndexOf(" ", selectionStart - 1) + 1;
    const candidate = currentState.text.slice(tokenStart, selectionStart);
    const parsedToken = parseStructuredSearchFilterToken(candidate);
    if (!parsedToken) {
      return false;
    }

    const { filters, index } = insertFilterAtTextInput(parsedToken);
    stageState({
      filters,
      text: normalizeSearchText(
        `${currentState.text.slice(0, tokenStart)} ${currentState.text.slice(selectionStart)}`
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
        ? { index: index + 1, kind: "text", toEnd: true }
        : { index, kind: "segment", selectAll: true };
    return true;
  };

  const clearSearch = () => {
    commitState({ filters: [], text: "" }, true);
    suppressNextBlurCommit();
    blurSearchField();
  };

  const runSearch = () => {
    commitState(currentState, true, { refreshIfUnchanged: true });
  };

  const queryClient = useQueryClient();
  const interpretMutation = useMutation(
    orpc.ai.interpretSearchQuery.mutationOptions()
  );

  const currentStateRef = useRef(currentState);
  useEffect(() => {
    currentStateRef.current = currentState;
  }, [currentState]);

  const applyInterpretedState = (
    search: StructuredSearchState,
    submittedQuery?: string
  ) => {
    const baseState = currentStateRef.current;
    const mergedFilters = mergeInterpretedFilters(
      baseState.filters,
      search.filters
    );
    const nextText =
      submittedQuery !== undefined &&
      normalizeSearchText(baseState.text) !== submittedQuery
        ? baseState.text
        : normalizeSearchText(search.text);
    commitState({ filters: mergedFilters, text: nextText }, true);
    focusTextInput({ toEnd: true });
  };

  const interpretNaturalLanguage = () => {
    const query = currentState.text.trim();
    if (query.length === 0 || interpretMutation.isPending) {
      return;
    }

    const labelNames = userLabels.map((label) => label.name);
    const localResult = parseNaturalLanguageMailSearch({
      labels: labelNames,
      text: query,
    });
    if (localResult.filters.length > 0) {
      applyInterpretedState(localResult);
      return;
    }

    interpretMutation.mutate(
      {
        availableLabels: labelNames,
        mailboxId,
        query,
      },
      {
        onError: (error) => {
          toastError(error, {
            boundary: "search-interpretation",
            fallback: "Could not read that search.",
          });
        },
        onSuccess: (result) => {
          void queryClient.invalidateQueries({
            queryKey: USER_BILLING_QUERY_KEY,
          });
          if (
            result.filters.length === 0 &&
            normalizeSearchText(result.text).length === 0
          ) {
            toast.message("Could not turn that into filters.");
            return;
          }
          applyInterpretedState(result, query);
        },
      }
    );
  };

  const selectDateFilterValue = (date: Date) => {
    if (activeDateFilterIndex === null) {
      return;
    }

    updateFilterValue(activeDateFilterIndex, formatDateFilterValue(date));
    openSearchDropdown();
    pendingFocusRef.current = {
      index: activeDateFilterIndex + 1,
      kind: "text",
      toEnd: true,
    };
  };

  const selectDatePreset = (filter: SearchFilterChip) => {
    if (activeDateFilterIndex === null) {
      return;
    }
    stageState({
      ...currentState,
      filters: currentState.filters.map((current, index) =>
        index === activeDateFilterIndex ? filter : current
      ),
    });
    setActiveDateFilterIndex(null);
    openDropdown(true);
    pendingFocusRef.current = {
      index: activeDateFilterIndex + 1,
      kind: "text",
      toEnd: true,
    };
  };

  useHotkey(
    "Mod+K",
    (event) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      openSearchDropdown();
      focusTextInput({ toEnd: true });
    },
    {
      ignoreInputs: true,
    }
  );

  useEffect((): (() => void) | undefined => {
    if (!isDropdownOpen && activeDateFilterIndex === null) {
      return undefined;
    }

    const handleOutsideSearchEvent = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !isSearchSurfaceTarget(event.target)
      ) {
        closeSearchOverlays();
      }
    };

    document.addEventListener("pointerdown", handleOutsideSearchEvent, true);
    document.addEventListener("focusin", handleOutsideSearchEvent, true);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleOutsideSearchEvent,
        true
      );
      document.removeEventListener("focusin", handleOutsideSearchEvent, true);
    };
  }, [activeDateFilterIndex, isDropdownOpen]);

  useLayoutEffect(() => {
    if (!pendingFocusRef.current) {
      return;
    }

    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (target.kind === "text") {
      focusTextInput({ index: target.index, toEnd: target.toEnd });
      return;
    }

    focusSegment(target.index, {
      selectAll: target.selectAll,
      toEnd: target.toEnd,
    });
  }, [currentState, focusTextInput]);

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
    setDatePopoverLeft(
      Math.max(0, Math.min(tokenRect.left - fieldRect.left, maxLeft))
    );
  }, [activeDateFilterIndex, currentState.filters, dateTokenRefs]);

  return {
    activeDateFilter,
    activeDateFilterIndex,
    availableFilterOptions,
    calendarFallbackMonth,
    clearSearch,
    currentState,
    cycleFilterFromPointer,
    datePopoverLeft,
    dismissSearch,
    fieldRef,
    focusTextInput,
    handleFilterSelection,
    handleSearchFieldBlur,
    handleSegmentInputKeyDown,
    handleTextInputKeyDown,
    handleTokenKeyDown,
    highlightedDropdownItemKey,
    interpretNaturalLanguage,
    isDropdownOpen,
    isInterpretingSearch: interpretMutation.isPending,
    isLoadingLabels: isLabelsPending,
    isRefreshing,
    labelsErrorMessage: isLabelsPending ? null : (labelsError?.message ?? null),
    onRefresh,
    onScrollToTop,
    openDateFilter,
    openSearchDropdown,
    removeFilterAtIndex,
    removeFilterFromPointer,
    runSearch,
    selectDateFilterValue,
    selectDatePreset,
    setDateTokenRef,
    setSegmentRef,
    suppressNextBlurCommit,
    textInputIndex: currentTextInputIndex,
    textInputRef,
    toggleLabelToken,
    updateFilterValue,
    updateSearchText,
    userLabels: isLabelsPending ? [] : userLabels,
  };
};

export type MessageListSearchController = ReturnType<
  typeof useMessageListSearchController
>;
