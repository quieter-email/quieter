"use client";

import {
  Cancel01Icon,
  Loading03Icon,
  Refresh01Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { Calendar } from "@quieter/ui/calendar";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { ArrowInteractionButton } from "#/components/arrow-interaction-button";
import { SpinWhileActive } from "#/components/spin-while-active";
import { mailboxLabelSearchPillSurfaceClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import { messageListHeaderControlVariants } from "#/features/message-list/components/message-list-header-surfaces";
import { normalizeLabelSelectionKey } from "#/features/message-search/state/message-list-search-state";

import { MessageListSearchDropdown } from "../message-list-search-dropdown";
import {
  isDateFilter,
  isFixedValueFilter,
  parseDateFilterValue,
} from "./message-list-search-utils";
import type { MessageListSearchController } from "./use-message-list-search-controller";

const getFilterLabel = (type: string) => {
  switch (type) {
    case "bcc": {
      return "Bcc";
    }
    case "cc": {
      return "Cc";
    }
    case "filename": {
      return "File";
    }
    case "from": {
      return "From";
    }
    case "to": {
      return "To";
    }
    case "newer_than": {
      return "Newer than";
    }
    case "older_than": {
      return "Older than";
    }
    default: {
      return type.charAt(0).toLocaleUpperCase() + type.slice(1);
    }
  }
};

export const MessageListSearchView = ({
  controller,
}: {
  controller: MessageListSearchController;
}) => {
  const {
    activeDateFilter,
    activeDateFilterIndex,
    availableFilterOptions,
    calendarFallbackMonth,
    clearSearch,
    currentState,
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
    isInterpretingSearch,
    isLoadingLabels,
    isRefreshing,
    labelsErrorMessage,
    onRefresh,
    onScrollToTop,
    openDateFilter,
    openSearchDropdown,
    removeFilterFromPointer,
    cycleFilterFromPointer,
    runSearch,
    selectDateFilterValue,
    selectDatePreset,
    setDateTokenRef,
    setSegmentRef,
    suppressNextBlurCommit,
    textInputRef,
    textInputIndex,
    toggleLabelToken,
    updateFilterValue,
    updateSearchText,
    userLabels,
  } = controller;
  const userLabelsBySelectionKey = new Map<string, MailboxLabel>();
  for (const label of userLabels) {
    if (label.type === "user") {
      userLabelsBySelectionKey.set(
        normalizeLabelSelectionKey(label.name),
        label
      );
    }
  }
  const filterTypeOccurrences = new Map<string, number>();
  const removeFilterOnMiddlePointer = (
    event: ReactPointerEvent<HTMLElement>,
    index: number
  ) => {
    if (event.button !== 1) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    removeFilterFromPointer(index);
    return true;
  };

  return (
    <search className="block min-w-0">
      <div className="flex h-9 min-w-0 items-stretch gap-2">
        <div className="flex self-stretch">
          <IconButtonTooltip label="Refresh list">
            <Button
              aria-label="Refresh list"
              className={messageListHeaderControlVariants({
                control: "toolbar",
              })}
              disabled={isRefreshing}
              onClick={() => void onRefresh()}
              size="icon"
              variant="ghost"
            >
              <SpinWhileActive active={isRefreshing}>
                <HugeiconsIcon icon={Refresh01Icon} />
              </SpinWhileActive>
            </Button>
          </IconButtonTooltip>
        </div>

        <div
          className="relative min-w-0 flex-1"
          onBlur={handleSearchFieldBlur}
          ref={fieldRef}
        >
          <div className="squircle flex min-h-9 min-w-0 items-center gap-1 rounded-xl border border-border bg-control p-1 shadow-xs transition-colors duration-150 ease-out has-[input[data-slot=search-input]:focus-visible]:border-ring has-[input[data-slot=search-input]:focus-visible]:ring-1 has-[input[data-slot=search-input]:focus-visible]:ring-ring/45 has-[input[data-slot=search-input]:focus-visible]:outline-none">
            <div
              className="flex min-w-0 flex-1 scroll-px-1 scrollbar-none items-center gap-1 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLElement)) {
                  return;
                }
                const { target } = event;
                if (target.closest("button, input")) {
                  return;
                }

                event.preventDefault();
                openSearchDropdown();
                focusTextInput({ toEnd: true });
              }}
              role="presentation"
            >
              {currentState.filters.map((filter, index) => {
                const filterOccurrence =
                  filterTypeOccurrences.get(filter.type) ?? 0;
                filterTypeOccurrences.set(filter.type, filterOccurrence + 1);
                const filterRenderKey = `${filter.type}:${filterOccurrence}`;

                if (filter.type === "label") {
                  const label = userLabelsBySelectionKey.get(
                    normalizeLabelSelectionKey(filter.value)
                  );

                  return (
                    <button
                      aria-label={
                        filter.negated === true
                          ? `Remove excluded label ${filter.value}`
                          : `Exclude label ${filter.value}`
                      }
                      className={cn(
                        messageListHeaderControlVariants({ control: "chip" }),
                        "gap-1",
                        label &&
                          mailboxLabelSearchPillSurfaceClassNameByColor[
                            label.color ?? "gray"
                          ]
                      )}
                      key={filterRenderKey}
                      style={{ order: index * 2 + 1 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleFilterFromPointer(index);
                      }}
                      onFocus={openSearchDropdown}
                      onKeyDown={(event) => {
                        handleTokenKeyDown(event, index);
                      }}
                      ref={(node) => {
                        setSegmentRef(index, node);
                      }}
                      onPointerDown={(event) => {
                        if (removeFilterOnMiddlePointer(event, index)) {
                          return;
                        }
                        if (document.activeElement === event.currentTarget) {
                          suppressNextBlurCommit();
                        }
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      type="button"
                    >
                      {filter.negated === true ? (
                        <span className="text-muted-fg">Not</span>
                      ) : null}
                      <span className="min-w-0 truncate">{filter.value}</span>
                    </button>
                  );
                }

                if (isFixedValueFilter(filter)) {
                  return (
                    <button
                      aria-label={
                        filter.negated === true
                          ? `Remove excluded ${filter.value} filter`
                          : `Exclude ${filter.value} filter`
                      }
                      className={cn(
                        messageListHeaderControlVariants({ control: "chip" }),
                        "gap-1"
                      )}
                      key={filterRenderKey}
                      style={{ order: index * 2 + 1 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleFilterFromPointer(index);
                      }}
                      onFocus={openSearchDropdown}
                      onKeyDown={(event) => {
                        handleTokenKeyDown(event, index);
                      }}
                      ref={(node) => {
                        setSegmentRef(index, node);
                      }}
                      onPointerDown={(event) => {
                        if (removeFilterOnMiddlePointer(event, index)) {
                          return;
                        }
                        if (document.activeElement === event.currentTarget) {
                          suppressNextBlurCommit();
                        }
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      type="button"
                    >
                      {filter.negated === true ? (
                        <span className="text-muted-fg">Not</span>
                      ) : null}
                      <span className="min-w-0 truncate">
                        {filter.value.charAt(0).toLocaleUpperCase() +
                          filter.value.slice(1).replaceAll("_", " ")}
                      </span>
                    </button>
                  );
                }

                const isCurrentFilterDate = isDateFilter(filter);
                return (
                  <div
                    className={cn(
                      messageListHeaderControlVariants({ control: "chip" }),
                      "gap-1",
                      {
                        "bg-control-active ring-2 ring-ring/30":
                          activeDateFilterIndex === index,
                      }
                    )}
                    key={filterRenderKey}
                    onPointerDown={(event) => {
                      removeFilterOnMiddlePointer(event, index);
                    }}
                    ref={(node) => {
                      setDateTokenRef(index, node);
                    }}
                    style={{ order: index * 2 + 1 }}
                  >
                    <button
                      aria-label={
                        filter.negated === true
                          ? `Remove excluded ${getFilterLabel(
                              filter.type
                            )} filter`
                          : `Exclude ${getFilterLabel(filter.type)} filter`
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-sm text-muted-fg hover:text-fg focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleFilterFromPointer(index);
                      }}
                      onPointerDown={(event) => {
                        if (removeFilterOnMiddlePointer(event, index)) {
                          return;
                        }
                        if (document.activeElement === event.currentTarget) {
                          suppressNextBlurCommit();
                        }
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      type="button"
                    >
                      {filter.negated === true ? <span>Not</span> : null}
                      <span>{getFilterLabel(filter.type)}</span>
                    </button>
                    <input
                      aria-label={`${filter.type} filter value`}
                      autoCapitalize="off"
                      autoCorrect="off"
                      className={cn(
                        "field-sizing-content max-w-56 min-w-[1ch] bg-transparent text-fg outline-none",
                        {
                          "placeholder:text-muted-fg": isCurrentFilterDate,
                        }
                      )}
                      onChange={(event) => {
                        updateFilterValue(index, event.currentTarget.value);
                      }}
                      onFocus={() => {
                        if (isCurrentFilterDate) {
                          openDateFilter(index);
                        } else {
                          openSearchDropdown();
                        }
                      }}
                      onKeyDown={(event) => {
                        handleSegmentInputKeyDown(event, index);
                      }}
                      onMouseDown={() => {
                        if (isCurrentFilterDate) {
                          openDateFilter(index);
                        }
                      }}
                      placeholder={isCurrentFilterDate ? "YYYY/M/D" : ""}
                      ref={(node) => {
                        setSegmentRef(index, node);
                      }}
                      spellCheck={false}
                      type="text"
                      value={filter.value}
                    />
                    <button
                      aria-label={`Remove ${getFilterLabel(
                        filter.type
                      )} filter`}
                      className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-fg hover:text-fg focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFilterFromPointer(index);
                      }}
                      onPointerDown={(event) => {
                        if (removeFilterOnMiddlePointer(event, index)) {
                          return;
                        }
                        if (document.activeElement === event.currentTarget) {
                          suppressNextBlurCommit();
                        }
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      type="button"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className="size-3"
                        icon={Cancel01Icon}
                      />
                    </button>
                  </div>
                );
              })}

              <input
                aria-label="Search"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className="box-border field-sizing-content h-6 max-w-full min-w-[3ch] shrink-0 grow basis-auto bg-transparent pl-2 text-body-sm text-fg outline-none placeholder:text-muted-fg"
                data-slot="search-input"
                onChange={(event) => {
                  updateSearchText(event.currentTarget.value);
                }}
                onFocus={openSearchDropdown}
                onKeyDown={handleTextInputKeyDown}
                placeholder={currentState.filters.length > 0 ? "" : "Search"}
                ref={textInputRef}
                spellCheck={false}
                style={{ order: textInputIndex * 2 }}
                type="text"
                value={currentState.text}
              />
            </div>

            <LazyMotion features={domAnimation}>
              <AnimatePresence>
                {currentState.text.trim().length > 0 && (
                  <IconButtonTooltip
                    key="interpret-search"
                    label="Convert to filters"
                  >
                    <Button
                      aria-label="Convert to filters"
                      className="size-6 shrink-0 rounded-lg text-muted-fg hover:bg-control-hover hover:text-fg"
                      onClick={(event) => {
                        event.stopPropagation();
                        interpretNaturalLanguage();
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                      render={
                        <m.button
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.15 }}
                        />
                      }
                    >
                      <HugeiconsIcon
                        className={cn("size-4", {
                          "animate-spin": isInterpretingSearch,
                        })}
                        icon={
                          isInterpretingSearch ? Loading03Icon : SparklesIcon
                        }
                      />
                    </Button>
                  </IconButtonTooltip>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {(currentState.text.length > 0 ||
                  currentState.filters.length > 0) && (
                  <IconButtonTooltip key="clear-search" label="Clear search">
                    <Button
                      aria-label="Clear search"
                      className="size-6 shrink-0 rounded-lg text-muted-fg hover:bg-control-hover hover:text-fg"
                      onClick={(event) => {
                        event.stopPropagation();
                        clearSearch();
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                      render={
                        <m.button
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.15 }}
                        />
                      }
                    >
                      <HugeiconsIcon icon={Cancel01Icon} />
                    </Button>
                  </IconButtonTooltip>
                )}
              </AnimatePresence>
            </LazyMotion>
            <IconButtonTooltip label="Run search">
              <Button
                aria-label="Run search"
                className="size-6 shrink-0 rounded-lg text-muted-fg hover:bg-control-hover hover:text-fg"
                onClick={(event) => {
                  event.stopPropagation();
                  runSearch();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={Search01Icon} />
              </Button>
            </IconButtonTooltip>
          </div>

          {activeDateFilter &&
            activeDateFilterIndex !== null &&
            (activeDateFilter.type === "after" ||
              activeDateFilter.type === "before") && (
              <div
                className="absolute top-full z-40 mt-2 max-h-[calc(100dvh-5rem)] max-w-[calc(100vw-1rem)] overflow-auto overscroll-contain rounded-lg bg-popover p-2 shadow-lg"
                style={{ left: datePopoverLeft }}
              >
                <div className="mb-2 grid grid-cols-2 gap-1 border-b pb-2">
                  <Button
                    onClick={() => {
                      selectDateFilterValue(calendarFallbackMonth);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Today
                  </Button>
                  <Button
                    onClick={() => {
                      selectDatePreset({ type: "newer_than", value: "7d" });
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Last 7 days
                  </Button>
                  <Button
                    onClick={() => {
                      selectDatePreset({ type: "newer_than", value: "30d" });
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Last 30 days
                  </Button>
                  <Button
                    onClick={() => {
                      selectDatePreset({
                        type: "after",
                        value: `${calendarFallbackMonth.getFullYear()}/1/1`,
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    This year
                  </Button>
                </div>
                <Calendar
                  mode="single"
                  month={
                    parseDateFilterValue(activeDateFilter.value) ??
                    calendarFallbackMonth
                  }
                  onSelect={(date) => {
                    if (date) {
                      selectDateFilterValue(date);
                    }
                  }}
                  selected={parseDateFilterValue(activeDateFilter.value)}
                />
              </div>
            )}

          <MessageListSearchDropdown
            draftSearchState={currentState}
            filterOptions={availableFilterOptions}
            highlightedItemKey={highlightedDropdownItemKey}
            isLoadingLabels={isLoadingLabels}
            isOpen={isDropdownOpen}
            labelsErrorMessage={labelsErrorMessage}
            onDismiss={dismissSearch}
            onSelectFilter={handleFilterSelection}
            onToggleLabel={toggleLabelToken}
            userLabels={userLabels}
          />
        </div>

        <div className="flex self-stretch">
          <IconButtonTooltip label="Scroll to top">
            <ArrowInteractionButton
              aria-label="Scroll to top"
              className={messageListHeaderControlVariants({
                control: "toolbar",
              })}
              onClick={onScrollToTop}
              size="icon"
              type="button"
              variant="ghost"
            />
          </IconButtonTooltip>
        </div>
      </div>
    </search>
  );
};
