"use client";

import type { ComponentPropsWithoutRef } from "react";
import {
  Cancel01Icon,
  Refresh01Icon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Calendar } from "@quieter/ui/calendar";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { ArrowInteractionButton } from "~/components/arrow-interaction-button";
import { SpinWhileActive } from "~/components/spin-while-active";
import { normalizeLabelSelectionKey } from "~/features/message-search/state/message-list-search-state";
import type { MessageListSearchController } from "./use-message-list-search-controller";
import { MessageListSearchDropdown } from "../message-list-search-dropdown";
import {
  filterChipClassName,
  isDateFilter,
  isFixedValueFilter,
  parseDateFilterValue,
} from "./message-list-search-utils";

const getFilterLabel = (type: string) => {
  switch (type) {
    case "bcc":
      return "Bcc";
    case "cc":
      return "Cc";
    case "filename":
      return "File";
    case "from":
      return "From";
    case "has":
      return "Has";
    case "is":
      return "Status";
    case "label":
      return "Label";
    case "to":
      return "To";
    case "newer_than":
      return "Newer than";
    case "older_than":
      return "Older than";
    default:
      return type.charAt(0).toLocaleUpperCase() + type.slice(1);
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
    fieldRef,
    focusTextInput,
    handleFilterSelection,
    handleSearchFieldBlur,
    handleSegmentInputKeyDown,
    handleTextInputKeyDown,
    handleTokenKeyDown,
    highlightedDropdownItemKey,
    isDropdownOpen,
    isLoadingLabels,
    isRefreshing,
    labelsErrorMessage,
    onOpenSidebar,
    onRefresh,
    onScrollToTop,
    openDateFilter,
    openSearchDropdown,
    removeFilterFromPointer,
    rowRef,
    runSearch,
    selectDateFilterValue,
    selectDatePreset,
    setDateTokenRef,
    setSegmentRef,
    suppressNextBlurCommit,
    textInputRef,
    toggleLabelToken,
    updateFilterValue,
    updateSearchText,
    userLabels,
  } = controller;
  return (
    <search className="block bg-transparent p-4">
      <div className="relative">
        <div className="flex min-w-0 items-center gap-2 lg:-ml-2">
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
            <div className="keyboard-focus-within flex h-8 min-w-0 items-center gap-1 rounded-md border border-input bg-background-light pr-1 shadow-sm transition-colors duration-150 ease-out squircle">
              <div
                className={cn(
                  "flex h-8 min-w-0 flex-1 scrollbar-none items-center gap-1 overflow-x-auto pr-2 [&::-webkit-scrollbar]:hidden",
                  {
                    "pl-0.75": currentState.filters.length > 0,
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
                          "gap-1 rounded-xs px-2 outline-none squircle hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
                        )}
                        key={`label:${normalizeLabelSelectionKey(filter.value)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFilterFromPointer(index);
                        }}
                        onFocus={openSearchDropdown}
                        onKeyDown={(event) =>
                          handleTokenKeyDown(event, index, { removeOnSpace: true })
                        }
                        ref={(node) => setSegmentRef(index, node)}
                        onPointerDown={(event) => {
                          if (document.activeElement === event.currentTarget) {
                            suppressNextBlurCommit();
                          }
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        type="button"
                      >
                        {filter.negated ? <span className="text-muted-foreground">Not</span> : null}
                        <span className="text-muted-foreground">Label</span>
                        <span>{filter.value}</span>
                      </button>
                    );
                  }

                  if (isFixedValueFilter(filter)) {
                    return (
                      <button
                        className={cn(
                          filterChipClassName,
                          "gap-1 rounded-xs px-2 outline-none squircle hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
                        )}
                        key={`${filter.type}:${filter.value}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFilterFromPointer(index);
                        }}
                        onFocus={openSearchDropdown}
                        onKeyDown={(event) => handleTokenKeyDown(event, index)}
                        ref={(node) => setSegmentRef(index, node)}
                        onPointerDown={(event) => {
                          if (document.activeElement === event.currentTarget) {
                            suppressNextBlurCommit();
                          }
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        type="button"
                      >
                        {filter.negated ? <span className="text-muted-foreground">Not</span> : null}
                        <span className="text-muted-foreground">{getFilterLabel(filter.type)}</span>
                        <span>{filter.value}</span>
                      </button>
                    );
                  }

                  const isCurrentFilterDate = isDateFilter(filter);
                  return (
                    <div
                      className={cn(
                        filterChipClassName,
                        "gap-1 rounded-xs px-1.5 transition-colors squircle",
                        {
                          "border-ring ring-2 ring-ring/20": activeDateFilterIndex === index,
                        },
                      )}
                      key={`${filter.type}:${filter.value}:${index}`}
                      ref={(node) => setDateTokenRef(index, node)}
                    >
                      {filter.negated ? (
                        <span className="shrink-0 text-muted-foreground">Not</span>
                      ) : null}
                      <span className="shrink-0 text-muted-foreground">
                        {getFilterLabel(filter.type)}
                      </span>
                      <input
                        aria-label={`${filter.type} filter value`}
                        autoCapitalize="off"
                        autoCorrect="off"
                        className={cn(
                          "field-sizing-content min-w-[1ch] bg-transparent text-foreground outline-none focus-visible:shadow-none",
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
                      <button
                        aria-label={`Remove ${getFilterLabel(filter.type)} filter`}
                        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFilterFromPointer(index);
                        }}
                        onPointerDown={(event) => {
                          if (document.activeElement === event.currentTarget) {
                            suppressNextBlurCommit();
                          }
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        type="button"
                      >
                        <HugeiconsIcon aria-hidden className="size-3" icon={Cancel01Icon} />
                      </button>
                    </div>
                  );
                })}

                <input
                  aria-label="Search"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="h-6 min-w-[8ch] flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:shadow-none"
                  onChange={(event) => updateSearchText(event.currentTarget.value)}
                  onFocus={openSearchDropdown}
                  onKeyDown={handleTextInputKeyDown}
                  placeholder={currentState.filters.length > 0 ? "" : "Search"}
                  ref={textInputRef}
                  spellCheck={false}
                  type="text"
                  value={currentState.text}
                />
              </div>

              <LazyMotion features={domAnimation}>
                <AnimatePresence>
                  {(currentState.text.length > 0 || currentState.filters.length > 0) && (
                    <IconButtonTooltip key="clear-search" label="Clear search">
                      <Button
                        aria-label="Clear search"
                        className="-mr-1 size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearSearch();
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                        render={(props) => (
                          <m.button
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.15 }}
                            {...(props as ComponentPropsWithoutRef<typeof m.button>)}
                          />
                        )}
                      >
                        <HugeiconsIcon className="size-4" icon={Cancel01Icon} />
                      </Button>
                    </IconButtonTooltip>
                  )}
                </AnimatePresence>
              </LazyMotion>
              <IconButtonTooltip label="Run search">
                <Button
                  aria-label="Run search"
                  className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    runSearch();
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
                  <div className="mb-2 grid grid-cols-2 gap-1 border-b pb-2">
                    <Button
                      onClick={() => selectDateFilterValue(calendarFallbackMonth)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Today
                    </Button>
                    <Button
                      onClick={() => selectDatePreset({ type: "newer_than", value: "7d" })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Last 7 days
                    </Button>
                    <Button
                      onClick={() => selectDatePreset({ type: "newer_than", value: "30d" })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Last 30 days
                    </Button>
                    <Button
                      onClick={() =>
                        selectDatePreset({
                          type: "after",
                          value: `${calendarFallbackMonth.getFullYear()}/1/1`,
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      This year
                    </Button>
                  </div>
                  <Calendar
                    mode="single"
                    month={parseDateFilterValue(activeDateFilter.value) ?? calendarFallbackMonth}
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
              onSelectFilter={handleFilterSelection}
              onToggleLabel={toggleLabelToken}
              userLabels={userLabels}
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
    </search>
  );
};
