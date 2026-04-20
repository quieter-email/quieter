"use client";

import { Refresh01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Calendar, IconButtonTooltip, cn } from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowInteractionButton } from "~/components/arrow-interaction-button";
import { SpinWhileActive } from "~/components/spin-while-active";
import {
  getUserLabels,
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

export type MessageListSearchProps = {
  isRefreshing: boolean;
  mailboxId: string;
  onRefresh: () => void | Promise<void>;
  onScrollToTop: () => boolean | Promise<boolean> | void | Promise<void>;
  onSearch: (query: string) => void;
  searchQuery: string;
};

type PendingFocusTarget =
  | { kind: "segment"; index: number; selectAll?: boolean; toEnd?: boolean }
  | { kind: "text"; toEnd?: boolean };

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

const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim();

const serializeStructuredSearchState = (state: StructuredSearchState) =>
  [...state.filters.map(serializeStructuredSearchFilterToken), normalizeSearchText(state.text)]
    .filter(Boolean)
    .join(" ")
    .trim();

const upsertFilter = (filters: readonly SearchFilterChip[], nextFilter: SearchFilterChip) => {
  if (nextFilter.type === "label") {
    const nextLabelKey = normalizeLabelSelectionKey(nextFilter.value);
    const existingIndex = filters.findIndex(
      (filter) =>
        filter.type === "label" && normalizeLabelSelectionKey(filter.value) === nextLabelKey,
    );

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

const removeTypedTokenFromText = (text: string, tokenStart: number, tokenEnd: number) =>
  normalizeSearchText(`${text.slice(0, tokenStart)} ${text.slice(tokenEnd)}`);

export const MessageListSearch = ({
  isRefreshing,
  mailboxId,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const segmentRefs = useRef<Array<HTMLElement | null>>([]);
  const dateTokenRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingFocusRef = useRef<PendingFocusTarget | null>(null);
  const openWithAnimationRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const [draftState, setDraftState] = useState<{
    baseQuery: string;
    value: StructuredSearchState;
  } | null>(null);
  const [animateDropdown, setAnimateDropdown] = useState(false);
  const [activeDateFilterIndex, setActiveDateFilterIndex] = useState<number | null>(null);
  const [activeDropdownIndex, setActiveDropdownIndex] = useState<number | null>(null);
  const [datePopoverLeft, setDatePopoverLeft] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const committedState = parseStructuredSearchQuery(searchQuery);
  const currentState = draftState?.baseQuery === searchQuery ? draftState.value : committedState;
  const labelsQuery = useQuery(labelsQueryOptions(mailboxId, isDropdownOpen));
  const userLabels = getUserLabels(labelsQuery.data ?? []);
  const activeDateFilter =
    activeDateFilterIndex === null ? null : (currentState.filters[activeDateFilterIndex] ?? null);

  const openDropdown = (preserveHighlight = false) => {
    setAnimateDropdown(openWithAnimationRef.current);
    openWithAnimationRef.current = false;
    if (!preserveHighlight) {
      setActiveDropdownIndex(null);
    }
    setIsDropdownOpen(true);
  };

  const closeDropdown = () => {
    setActiveDropdownIndex(null);
    setAnimateDropdown(false);
    setIsDropdownOpen(false);
  };

  const stageState = (nextState: StructuredSearchState) => {
    setDraftState({
      baseQuery: searchQuery,
      value: nextState,
    });
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

  const commitState = (nextState: StructuredSearchState, closeAfterCommit = false) => {
    const normalizedState = {
      filters: nextState.filters.filter((filter) => filter.value.trim().length > 0),
      text: normalizeSearchText(nextState.text),
    };

    setDraftState({
      baseQuery: searchQuery,
      value: normalizedState,
    });
    void onScrollToTop();
    onSearch(serializeStructuredSearchState(normalizedState));
    if (closeAfterCommit) {
      closeDropdown();
      setActiveDateFilterIndex(null);
    }
  };

  const handleFilterSelection = (type: SearchFieldFilterType) => {
    const { filters, index } = upsertFilter(currentState.filters, { type, value: "" });
    stageState({
      ...currentState,
      filters,
    });

    closeDropdown();
    if (type === "after" || type === "before") {
      setActiveDateFilterIndex(index);
    } else {
      setActiveDateFilterIndex(null);
    }

    pendingFocusRef.current = { index, kind: "segment", selectAll: true };
  };

  const toggleLabelToken = (labelName: string) => {
    const nextLabelKey = normalizeLabelSelectionKey(labelName);
    const existingIndex = currentState.filters.findIndex(
      (filter) =>
        filter.type === "label" && normalizeLabelSelectionKey(filter.value) === nextLabelKey,
    );

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
      onSelect: () => {
        handleFilterSelection(option.type);
      },
    })),
    ...(labelsQuery.isPending || labelsQuery.error
      ? []
      : userLabels.map((label) => ({
          key: `label:${normalizeLabelSelectionKey(label.name)}`,
          onSelect: () => {
            toggleLabelToken(label.name);
          },
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

  const handleDropdownNavigation = (direction: "next" | "previous") => {
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

    setActiveDateFilterIndex(null);
    openDropdown();
    if (direction === "previous") {
      focusPreviousSegment(index);
      return;
    }

    focusNextSegment(index);
  };

  const exitSegmentToTextInput = () => {
    setActiveDateFilterIndex(null);
    openDropdown();
    focusTextInput({ toEnd: true });
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

    const nextText = removeTypedTokenFromText(currentState.text, tokenStart, selectionStart);
    const { filters, index } = upsertFilter(currentState.filters, parsedToken);
    stageState({
      filters,
      text: nextText,
    });

    if (parsedToken.type === "after" || parsedToken.type === "before") {
      setActiveDateFilterIndex(index);
      closeDropdown();
      pendingFocusRef.current = { index, kind: "segment", selectAll: true };
      return true;
    }

    setActiveDateFilterIndex(null);
    openDropdown();
    pendingFocusRef.current =
      parsedToken.type === "label"
        ? { kind: "text", toEnd: true }
        : { index, kind: "segment", selectAll: true };
    return true;
  };

  useEffect(() => {
    if (!isDropdownOpen && activeDateFilterIndex === null) {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }

      closeDropdown();
      setActiveDateFilterIndex(null);
    };

    const handleFocusInOutside = (event: FocusEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }

      closeDropdown();
      setActiveDateFilterIndex(null);
    };

    document.addEventListener("pointerdown", handlePointerDownOutside);
    document.addEventListener("focusin", handleFocusInOutside);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
      document.removeEventListener("focusin", handleFocusInOutside);
    };
  }, [activeDateFilterIndex, isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen || activeDateFilterIndex !== null) {
      if (activeDropdownIndex !== null) {
        setActiveDropdownIndex(null);
      }
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
    <LazyMotion features={domAnimation}>
      <div className="border-b border-border bg-background-light px-4 py-3" role="search">
        <div ref={containerRef} className="relative">
          <div className="flex min-w-0 items-center gap-2">
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

            <div ref={fieldRef} className="relative min-w-0 flex-1">
              <div
                className="flex h-8 min-w-0 items-center gap-1 rounded-md border border-input bg-background pr-1 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
                onPointerDownCapture={(event) => {
                  if (event.pointerType) {
                    openWithAnimationRef.current = true;
                  }
                }}
              >
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
                    setActiveDateFilterIndex(null);
                    openDropdown();
                    focusTextInput({ toEnd: true });
                  }}
                  ref={rowRef}
                  role="presentation"
                >
                  {currentState.filters.map((filter, index) => {
                    if (filter.type === "label") {
                      return (
                        <button
                          className="inline-flex h-6 shrink-0 items-center rounded-sm border border-border/80 bg-muted/80 px-2 text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                          key={`label:${normalizeLabelSelectionKey(filter.value)}`}
                          onClick={() => {
                            removeFilterAtIndex(index);
                          }}
                          onFocus={() => {
                            setActiveDateFilterIndex(null);
                            openDropdown();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                              event.preventDefault();
                              handleDropdownNavigation(
                                event.key === "ArrowDown" ? "next" : "previous",
                              );
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
                          }}
                          ref={(node) => {
                            segmentRefs.current[index] = node;
                          }}
                          type="button"
                        >
                          {filter.value}
                        </button>
                      );
                    }

                    const isDateFilter = filter.type === "after" || filter.type === "before";
                    return (
                      <div
                        className={cn(
                          "inline-flex h-6 shrink-0 items-center gap-1 rounded-xs border border-border/80 bg-muted/80 px-1.5 text-[13px] text-foreground transition-colors",
                          {
                            "border-ring ring-2 ring-ring/20": activeDateFilterIndex === index,
                          },
                        )}
                        key={filter.type}
                        ref={(node) => {
                          if (node) {
                            dateTokenRefs.current.set(index, node);
                            return;
                          }

                          dateTokenRefs.current.delete(index);
                        }}
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
                              "placeholder:text-muted-foreground": isDateFilter,
                            },
                          )}
                          onChange={(event) => {
                            const nextFilters = [...currentState.filters];
                            nextFilters[index] = {
                              ...nextFilters[index],
                              value: event.currentTarget.value,
                            };
                            stageState({
                              ...currentState,
                              filters: nextFilters,
                            });
                          }}
                          onFocus={() => {
                            if (isDateFilter) {
                              setActiveDateFilterIndex(index);
                              closeDropdown();
                              return;
                            }

                            setActiveDateFilterIndex(null);
                            openDropdown();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                              if (activeDateFilterIndex !== null) {
                                return;
                              }

                              event.preventDefault();
                              handleDropdownNavigation(
                                event.key === "ArrowDown" ? "next" : "previous",
                              );
                              return;
                            }

                            if (
                              event.key === "ArrowLeft" &&
                              event.currentTarget.selectionStart === 0 &&
                              event.currentTarget.selectionEnd === 0
                            ) {
                              event.preventDefault();
                              moveOutOfSegment(index, "previous");
                              return;
                            }

                            if (
                              event.key === "ArrowRight" &&
                              event.currentTarget.selectionStart ===
                                event.currentTarget.value.length &&
                              event.currentTarget.selectionEnd === event.currentTarget.value.length
                            ) {
                              event.preventDefault();
                              moveOutOfSegment(index, "next");
                              return;
                            }

                            if (event.key === " ") {
                              event.preventDefault();
                              exitSegmentToTextInput();
                              return;
                            }

                            if (
                              event.key === "Backspace" &&
                              event.currentTarget.value.length === 0
                            ) {
                              event.preventDefault();
                              removeFilterAtIndex(
                                index,
                                index === 0
                                  ? { kind: "text", toEnd: true }
                                  : {
                                      index: index - 1,
                                      kind: "segment",
                                      toEnd: currentState.filters[index - 1]?.type !== "label",
                                    },
                              );
                              return;
                            }

                            if (event.key === "Enter") {
                              event.preventDefault();
                              if (activateHighlightedDropdownItem()) {
                                return;
                              }

                              commitState(currentState, true);
                              return;
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              setActiveDateFilterIndex(null);
                              closeDropdown();
                            }
                          }}
                          onMouseDown={() => {
                            if (isDateFilter) {
                              setActiveDateFilterIndex(index);
                              closeDropdown();
                            }
                          }}
                          placeholder={isDateFilter ? "YYYY/M/D" : ""}
                          ref={(node) => {
                            segmentRefs.current[index] = node;
                          }}
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
                    onFocus={() => {
                      setActiveDateFilterIndex(null);
                      openDropdown();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " ") {
                        const didCommitTypedToken = handleTextInputSpace();
                        if (didCommitTypedToken) {
                          event.preventDefault();
                          return;
                        }
                      }

                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        handleDropdownNavigation(event.key === "ArrowDown" ? "next" : "previous");
                        return;
                      }

                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (activateHighlightedDropdownItem()) {
                          return;
                        }

                        commitState(currentState, true);
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
                        event.currentTarget.selectionStart === 0 &&
                        event.currentTarget.selectionEnd === 0 &&
                        currentState.filters.length > 0
                      ) {
                        event.preventDefault();
                        focusSegment(currentState.filters.length - 1, {
                          toEnd: currentState.filters.at(-1)?.type !== "label",
                        });
                      }
                    }}
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
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      commitState(currentState, true);
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
              (activeDateFilter.type === "after" || activeDateFilter.type === "before") ? (
                <div
                  className="absolute top-full z-40 mt-2 rounded-lg border border-border bg-popover p-2 shadow-lg"
                  style={{ left: datePopoverLeft }}
                >
                  <Calendar
                    mode="single"
                    month={parseDateFilterValue(activeDateFilter.value) ?? new Date()}
                    onSelect={(date) => {
                      if (!date) {
                        return;
                      }

                      const nextFilters = [...currentState.filters];
                      nextFilters[activeDateFilterIndex] = {
                        ...nextFilters[activeDateFilterIndex],
                        value: formatDateFilterValue(date),
                      };
                      stageState({
                        ...currentState,
                        filters: nextFilters,
                      });
                      setActiveDateFilterIndex(null);
                      openDropdown();
                      pendingFocusRef.current = { kind: "text", toEnd: true };
                    }}
                    selected={parseDateFilterValue(activeDateFilter.value)}
                  />
                </div>
              ) : null}

              <AnimatePresence initial={false}>
                {isDropdownOpen ? (
                  <m.div
                    animate={{ opacity: 1, transform: "translateY(0px)" }}
                    className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-border bg-popover p-2 shadow-lg"
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
                      draftSearchState={currentState}
                      highlightedItemKey={highlightedDropdownItemKey}
                      isLoadingLabels={labelsQuery.isPending}
                      labelsErrorMessage={
                        labelsQuery.isPending ? null : (labelsQuery.error?.message ?? null)
                      }
                      onSelectFilter={handleFilterSelection}
                      onToggleLabel={toggleLabelToken}
                      userLabels={labelsQuery.isPending ? [] : userLabels}
                    />
                  </m.div>
                ) : null}
              </AnimatePresence>
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
    </LazyMotion>
  );
};
