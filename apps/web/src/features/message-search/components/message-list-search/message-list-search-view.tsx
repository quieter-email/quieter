"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
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
import { mailboxLabelSearchPillSurfaceClassNameByColor } from "~/features/message-labels/domain/mailbox-label-presentation";
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

const searchToolbarControlClassName =
  "h-full w-9 rounded-xl bg-secondary/55 text-muted-fg shadow-none hover:bg-muted hover:text-fg [&_svg]:size-3.5";

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
      userLabelsBySelectionKey.set(normalizeLabelSelectionKey(label.name), label);
    }
  }
  const filterTypeOccurrences = new Map<string, number>();

  return (
    <search className="@container block bg-transparent p-2 @sm:px-4 @sm:pt-4 @sm:pb-3">
      <div className="relative">
        <div className="flex min-w-0 items-stretch gap-2 lg:-ml-2">
          {onOpenSidebar && (
            <div className="flex self-stretch">
              <IconButtonTooltip label="Open sidebar">
                <Button
                  aria-label="Open sidebar"
                  className={cn(searchToolbarControlClassName, "lg:hidden")}
                  onClick={onOpenSidebar}
                  size="icon-lg"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={SidebarLeftIcon} />
                </Button>
              </IconButtonTooltip>
            </div>
          )}

          <div className="flex self-stretch">
            <IconButtonTooltip label="Refresh list">
              <Button
                aria-label="Refresh list"
                className={searchToolbarControlClassName}
                disabled={isRefreshing}
                onClick={() => void onRefresh()}
                size="icon-lg"
                variant="ghost"
              >
                <SpinWhileActive active={isRefreshing}>
                  <HugeiconsIcon icon={Refresh01Icon} />
                </SpinWhileActive>
              </Button>
            </IconButtonTooltip>
          </div>

          <div className="relative min-w-0 flex-1" onBlur={handleSearchFieldBlur} ref={fieldRef}>
            <div className="squircle flex min-h-9 min-w-0 items-center gap-1 rounded-xl border border-transparent bg-secondary/55 p-1 transition-colors duration-150 ease-out has-[input[data-slot=search-input]:focus-visible]:border-ring has-[input[data-slot=search-input]:focus-visible]:ring-1 has-[input[data-slot=search-input]:focus-visible]:ring-ring/45 has-[input[data-slot=search-input]:focus-visible]:outline-none">
              <div
                className="flex min-w-0 flex-1 scroll-px-1 scrollbar-none items-center gap-1 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
                onMouseDown={(event) => {
                  const target = event.target as HTMLElement;
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
                  const filterOccurrence = filterTypeOccurrences.get(filter.type) ?? 0;
                  filterTypeOccurrences.set(filter.type, filterOccurrence + 1);
                  const filterRenderKey = `${filter.type}:${filterOccurrence}`;

                  if (filter.type === "label") {
                    const label = userLabelsBySelectionKey.get(
                      normalizeLabelSelectionKey(filter.value),
                    );

                    return (
                      <button
                        className={cn(
                          filterChipClassName,
                          "gap-1",
                          label &&
                            mailboxLabelSearchPillSurfaceClassNameByColor[label.color ?? "gray"],
                        )}
                        key={filterRenderKey}
                        style={{ order: index * 2 + 1 }}
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
                        {filter.negated ? <span className="text-muted-fg">Not</span> : null}
                        <span className="min-w-0 truncate">{filter.value}</span>
                      </button>
                    );
                  }

                  if (isFixedValueFilter(filter)) {
                    return (
                      <button
                        className={cn(filterChipClassName, "gap-1")}
                        key={filterRenderKey}
                        style={{ order: index * 2 + 1 }}
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
                        {filter.negated ? <span className="text-muted-fg">Not</span> : null}
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
                      className={cn(filterChipClassName, "gap-1", {
                        "bg-accent ring-2 ring-ring/30": activeDateFilterIndex === index,
                      })}
                      key={filterRenderKey}
                      ref={(node) => setDateTokenRef(index, node)}
                      style={{ order: index * 2 + 1 }}
                    >
                      {filter.negated ? <span className="shrink-0 text-muted-fg">Not</span> : null}
                      <span className="shrink-0 text-muted-fg">{getFilterLabel(filter.type)}</span>
                      <input
                        aria-label={`${filter.type} filter value`}
                        autoCapitalize="off"
                        autoCorrect="off"
                        className={cn(
                          "field-sizing-content max-w-56 min-w-[1ch] bg-transparent text-fg outline-none",
                          {
                            "placeholder:text-muted-fg": isCurrentFilterDate,
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
                        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-fg hover:text-fg focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
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
                  autoComplete="off"
                  autoCorrect="off"
                  className="box-border field-sizing-content h-6 max-w-full min-w-[3ch] shrink-0 grow basis-auto bg-transparent pl-2 text-[13px] text-fg outline-none placeholder:text-muted-fg"
                  data-slot="search-input"
                  onChange={(event) => updateSearchText(event.currentTarget.value)}
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
                  {(currentState.text.length > 0 || currentState.filters.length > 0) && (
                    <IconButtonTooltip key="clear-search" label="Clear search">
                      <Button
                        aria-label="Clear search"
                        className="size-6 shrink-0 rounded-lg text-muted-fg hover:bg-muted hover:text-fg"
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
                        <HugeiconsIcon icon={Cancel01Icon} />
                      </Button>
                    </IconButtonTooltip>
                  )}
                </AnimatePresence>
              </LazyMotion>
              <IconButtonTooltip label="Run search">
                <Button
                  aria-label="Run search"
                  className="size-6 shrink-0 rounded-lg text-muted-fg hover:bg-muted hover:text-fg"
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
              (activeDateFilter.type === "after" || activeDateFilter.type === "before") && (
                <div
                  className="absolute top-full z-40 mt-2 max-h-[calc(100dvh-5rem)] max-w-[calc(100vw-1rem)] overflow-auto overscroll-contain rounded-lg bg-popover p-2 shadow-lg"
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
                className={searchToolbarControlClassName}
                onClick={async () => {
                  const didScroll = await onScrollToTop();
                  return typeof didScroll === "boolean" ? didScroll : true;
                }}
                size="icon-lg"
                type="button"
                variant="ghost"
              />
            </IconButtonTooltip>
          </div>
        </div>
      </div>
    </search>
  );
};
