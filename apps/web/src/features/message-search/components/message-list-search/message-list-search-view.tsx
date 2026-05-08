"use client";

import type { ComponentPropsWithoutRef } from "react";
import {
  Cancel01Icon,
  Refresh01Icon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Calendar, IconButtonTooltip, cn } from "@quieter/ui";
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

export const MessageListSearchView = ({
  controller,
}: {
  controller: MessageListSearchController;
}) => {
  const {
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
    isLoadingLabels,
    isRefreshing,
    labelsErrorMessage,
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
    userLabels,
  } = controller;

  return (
    <div className="bg-background-light p-4" role="search">
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
                        onKeyDown={(event) =>
                          handleTokenKeyDown(event, index, { removeOnSpace: true })
                        }
                        ref={(node) => setSegmentRef(index, node)}
                        type="button"
                      >
                        {filter.value}
                      </button>
                    );
                  }

                  if (isFixedValueFilter(filter)) {
                    return (
                      <button
                        className={cn(
                          filterChipClassName,
                          "squircle rounded-xs px-2 outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
                        )}
                        key={`${filter.type}:${filter.value}`}
                        onClick={() => removeFilterAtIndex(index)}
                        onFocus={openSearchDropdown}
                        onKeyDown={(event) => handleTokenKeyDown(event, index)}
                        ref={(node) => setSegmentRef(index, node)}
                        type="button"
                      >
                        {`${filter.type}:${filter.value}`}
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
    </div>
  );
};
