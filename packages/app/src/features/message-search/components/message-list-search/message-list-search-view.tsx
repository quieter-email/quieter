"use client";

import {
  Cancel01Icon,
  Refresh01Icon,
  Search01Icon,
  FilterHorizontalIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { ArrowInteractionButton } from "@quieter/app/components/arrow-interaction-button";
import { SpinWhileActive } from "@quieter/app/components/spin-while-active";
import { AssistantSidebarTrigger } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { ShortcutHint } from "@quieter/app/features/hotkeys/components/shortcut-hint";
import { mailboxLabelSearchPillSurfaceClassNameByColor } from "@quieter/app/features/message-labels/domain/mailbox-label-presentation";
import { MessageListSearchDropdown } from "@quieter/app/features/message-search/components/message-list-search-dropdown";
import {
  isDateFilter,
  isFixedValueFilter,
  parseDateFilterValue,
} from "@quieter/app/features/message-search/components/message-list-search/message-list-search-utils";
import type { MessageListSearchController } from "@quieter/app/features/message-search/components/message-list-search/use-message-list-search-controller";
import { normalizeLabelSelectionKey } from "@quieter/app/features/message-search/state/message-list-search-state";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { Calendar } from "@quieter/ui/calendar";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { popupSurfaceClassName } from "@quieter/ui/popup-surface";
import { useId, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

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
    dismissSearch,
    fieldRef,
    focusTextInput,
    handleFilterSelection,
    handleSearchFieldBlur,
    handleSegmentInputKeyDown,
    handleTextInputKeyDown,
    handleTokenKeyDown,
    interpretNaturalLanguage,
    isDropdownOpen,
    isInterpretingSearch,
    isLoadingLabels,
    isRefreshing,
    labelsErrorMessage,
    onRefresh,
    onScrollToTop,
    openDateFilter,
    focusSearchInput,
    openSearchDropdown,
    removeAppliedFilter,
    cycleAppliedFilter,
    runSearch,
    selectDateFilterValue,
    selectDatePreset,
    setSegmentRef,
    textInputRef,
    toggleLabelToken,
    updateFilterValue,
    updateSearchText,
    userLabels,
  } = controller;
  const userLabelsBySelectionKey = new Map<string, MailboxLabel>();
  for (const label of userLabels) {
    if (label.type === "user") {
      userLabelsBySelectionKey.set(normalizeLabelSelectionKey(label.id), label);
      userLabelsBySelectionKey.set(
        normalizeLabelSelectionKey(label.name),
        label
      );
    }
  }
  const dropdownId = useId();
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const hasSearch =
    currentState.text.length > 0 || currentState.filters.length > 0;
  const focusDropdownEdge = (last: boolean) => {
    openSearchDropdown();
    requestAnimationFrame(() => {
      const options = document
        .querySelector(`#${CSS.escape(dropdownId)}`)
        ?.querySelectorAll<HTMLButtonElement>("[data-search-option]");
      options?.item(last ? options.length - 1 : 0)?.focus();
    });
  };
  const closeFilters = () => {
    if (
      document
        .querySelector(`#${CSS.escape(dropdownId)}`)
        ?.contains(document.activeElement) === true ||
      calendarRef.current?.contains(document.activeElement) === true
    ) {
      filtersButtonRef.current?.focus();
    }
    dismissSearch();
  };
  const filterTypeOccurrences = new Map<string, number>();
  const removeFilterOnMiddlePointer = (
    event: ReactPointerEvent<HTMLElement>,
    index: number
  ) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    removeAppliedFilter(index, false);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape dismisses the picker from any of its focused controls.
    <search
      className="relative block min-w-0"
      onBlur={handleSearchFieldBlur}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          (isDropdownOpen || activeDateFilterIndex !== null)
        ) {
          event.preventDefault();
          event.stopPropagation();
          closeFilters();
        }
      }}
      ref={fieldRef}
    >
      <div className="flex h-8 min-w-0 items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-xl border border-transparent bg-control px-1 squircle has-[input:focus-visible]:border-ring">
          <IconButtonTooltip label="Run search">
            <Button
              aria-label="Run search"
              className="hidden @sm:inline-flex"
              onClick={runSearch}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Icon icon={Search01Icon} />
            </Button>
          </IconButtonTooltip>
          <input
            aria-label="Search"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-body-sm text-fg outline-none placeholder:text-muted-fg"
            enterKeyHint="search"
            onChange={(event) => {
              updateSearchText(event.currentTarget.value);
            }}
            onFocus={focusSearchInput}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusDropdownEdge(event.key === "ArrowUp");
                return;
              }
              handleTextInputKeyDown(event);
            }}
            placeholder="Search"
            ref={textInputRef}
            spellCheck={false}
            type="text"
            value={currentState.text}
          />
          {currentState.text.trim().length > 0 && (
            <IconButtonTooltip label="Convert to filters">
              <Button
                aria-label="Convert to filters"
                onClick={interpretNaturalLanguage}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                pending={isInterpretingSearch}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Icon icon={SparklesIcon} />
              </Button>
            </IconButtonTooltip>
          )}
          <div className="grid shrink-0 place-items-center @sm:min-w-6">
            <ShortcutHint
              className={cn(
                "col-start-1 row-start-1 mx-1 hidden @sm:inline-flex",
                {
                  invisible: hasSearch || isDropdownOpen,
                }
              )}
              shortcutId="focus-search"
            />
            {hasSearch && (
              <div className="col-start-1 row-start-1">
                <IconButtonTooltip label="Clear search">
                  <Button
                    aria-label="Clear search"
                    onClick={clearSearch}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Icon icon={Cancel01Icon} />
                  </Button>
                </IconButtonTooltip>
              </div>
            )}
          </div>
        </div>
        <IconButtonTooltip label="Search filters">
          <Button
            aria-controls={isDropdownOpen ? dropdownId : undefined}
            aria-expanded={isDropdownOpen}
            aria-label="Search filters"
            chrome="toolbar"
            onClick={(event) => {
              if (isDropdownOpen) {
                dismissSearch();
              } else if (event.detail === 0) {
                focusDropdownEdge(false);
              } else {
                openSearchDropdown();
                focusTextInput({ toEnd: true });
              }
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            ref={filtersButtonRef}
            size="icon"
            type="button"
            variant={isDropdownOpen ? "secondary" : "toolbar"}
          >
            <Icon icon={FilterHorizontalIcon} />
          </Button>
        </IconButtonTooltip>
        <div
          className="flex shrink-0 items-center gap-2"
          data-mail-list-actions=""
        >
          <div className="flex self-stretch">
            <IconButtonTooltip label="Refresh list">
              <Button
                aria-label="Refresh list"
                disabled={isRefreshing}
                onClick={() => void onRefresh()}
                size="icon"
                variant="toolbar"
              >
                <SpinWhileActive active={isRefreshing}>
                  <Icon icon={Refresh01Icon} />
                </SpinWhileActive>
              </Button>
            </IconButtonTooltip>
          </div>

          <div className="flex self-stretch">
            <IconButtonTooltip label="Scroll to top">
              <ArrowInteractionButton
                aria-label="Scroll to top"
                onClick={onScrollToTop}
                size="icon"
                type="button"
                variant="toolbar"
              />
            </IconButtonTooltip>
          </div>
          <AssistantSidebarTrigger className="data-[sidebar-open=true]:-ms-2" />
        </div>
      </div>
      {currentState.filters.length > 0 && (
        <fieldset
          aria-label="Applied filters"
          className="mt-2 flex max-h-24 min-w-0 flex-wrap items-start gap-1 overflow-y-auto overscroll-contain"
        >
          {currentState.filters.map((filter, index) => {
            const occurrence = filterTypeOccurrences.get(filter.type) ?? 0;
            filterTypeOccurrences.set(filter.type, occurrence + 1);
            const label =
              filter.type === "label"
                ? userLabelsBySelectionKey.get(
                    normalizeLabelSelectionKey(filter.value)
                  )
                : undefined;
            const isFixed =
              filter.type === "label" || isFixedValueFilter(filter);
            const isDate = isDateFilter(filter);
            let name = getFilterLabel(filter.type);
            if (filter.type === "label") {
              name = label?.name ?? filter.value;
            } else if (isFixed) {
              name =
                filter.value.charAt(0).toLocaleUpperCase() +
                filter.value.slice(1).replaceAll("_", " ");
            }
            const color = label?.color;
            const customColor = color?.startsWith("#") === true;
            const style:
              | (CSSProperties & { "--selected-color": string })
              | undefined = customColor
              ? { "--selected-color": color }
              : undefined;

            return (
              <div
                className={cn(
                  // The compound filter keeps its content-sized value editor and independent actions.
                  "inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-md bg-control px-1 text-body-sm text-fg squircle has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-inset",
                  {
                    [mailboxLabelSearchPillSurfaceClassNameByColor[
                      color ?? "gray"
                    ] ?? ""]: label !== undefined,
                    "bg-control-active": activeDateFilterIndex === index,
                    "q-custom-color-surface": customColor,
                  }
                )}
                key={`${filter.type}:${occurrence}`}
                onPointerDown={(event) => {
                  removeFilterOnMiddlePointer(event, index);
                }}
                style={style}
              >
                <button
                  aria-label={
                    filter.negated === true
                      ? `Remove excluded ${name} filter`
                      : `Exclude ${name} filter`
                  }
                  className={cn(
                    "min-w-0 truncate rounded-sm px-1 hover:text-fg focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset",
                    { "shrink-0 text-muted-fg": !isFixed }
                  )}
                  onClick={(event) => {
                    cycleAppliedFilter(index, event.detail === 0);
                  }}
                  onKeyDown={(event) => {
                    if (isFixed) {
                      handleTokenKeyDown(event, index);
                    }
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  ref={
                    isFixed
                      ? (node) => {
                          setSegmentRef(index, node);
                        }
                      : undefined
                  }
                  title={isFixed ? name : undefined}
                  type="button"
                >
                  {filter.negated === true ? `Not ${name}` : name}
                </button>
                {!isFixed && (
                  <input
                    aria-label={`${name} filter value`}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="field-sizing-content max-w-48 min-w-[2ch] bg-transparent text-fg outline-none placeholder:text-muted-fg"
                    onChange={(event) => {
                      updateFilterValue(index, event.currentTarget.value);
                    }}
                    onFocus={() => {
                      if (isDate) {
                        openDateFilter(index);
                      } else {
                        dismissSearch();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowDown" &&
                        activeDateFilterIndex === index
                      ) {
                        event.preventDefault();
                        calendarRef.current
                          ?.querySelector<HTMLButtonElement>("button")
                          ?.focus();
                        return;
                      }
                      handleSegmentInputKeyDown(event, index);
                    }}
                    onMouseDown={() => {
                      if (isDate) {
                        openDateFilter(index);
                      }
                    }}
                    placeholder={isDate ? "YYYY/M/D" : "Value"}
                    ref={(node) => {
                      setSegmentRef(index, node);
                    }}
                    spellCheck={false}
                    type="text"
                    value={filter.value}
                  />
                )}
                <IconButtonTooltip label={`Remove ${name} filter`}>
                  <Button
                    aria-label={`Remove ${name} filter`}
                    focusRing="inset"
                    onClick={(event) => {
                      removeAppliedFilter(index, event.detail === 0);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Icon icon={Cancel01Icon} />
                  </Button>
                </IconButtonTooltip>
              </div>
            );
          })}
        </fieldset>
      )}
      {activeDateFilter &&
        activeDateFilterIndex !== null &&
        (activeDateFilter.type === "after" ||
          activeDateFilter.type === "before") && (
          <section
            aria-label="Choose a date"
            className={cn(
              popupSurfaceClassName,
              "absolute inset-s-0 top-full z-40 mt-2 max-h-[calc(100dvh-10rem)] max-w-full overflow-auto overscroll-contain rounded-xl p-2"
            )}
            data-blocking-overlay=""
            ref={calendarRef}
            onPointerDown={(event) => {
              if (
                !(
                  event.target instanceof Element &&
                  event.target.closest("button")
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <div className="mb-2 grid grid-cols-2 gap-1 border-b border-fg/10 pb-2">
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
              key={activeDateFilterIndex}
              defaultMonth={
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
          </section>
        )}

      <MessageListSearchDropdown
        draftSearchState={currentState}
        filterOptions={availableFilterOptions}
        id={dropdownId}
        isLoadingLabels={isLoadingLabels}
        isOpen={isDropdownOpen}
        labelsErrorMessage={labelsErrorMessage}
        onDismiss={closeFilters}
        onRunSearch={() => {
          closeFilters();
          runSearch();
        }}
        onSelectFilter={handleFilterSelection}
        onToggleLabel={toggleLabelToken}
        userLabels={userLabels}
      />
    </search>
  );
};
