"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { Input } from "@quieter/ui/input";
import { useRef, useState } from "react";

import { isDemoModeAvailable } from "#/features/settings/domain/demo-mode-setting";
import type { SettingsDetailTab } from "#/features/settings/domain/settings-navigation";
import { matchSettingsEntries } from "#/features/settings/domain/settings-search";

/**
 * One search field, in the same place on every Settings page. It is fixed and
 * centered rather than anchored to the back button, because the back button
 * changes label and disappears entirely on team and domain detail pages.
 */
export const SettingsSearch = ({
  onPrefetchTab,
  onSelectTab,
}: {
  onPrefetchTab: (tab: SettingsDetailTab) => void;
  onSelectTab: (tab: SettingsDetailTab) => void;
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = matchSettingsEntries(query, {
    includeDevelopment: isDemoModeAvailable(),
  });
  const isOpen = isFocused && query.trim() !== "";
  const boundedIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const selectTab = (tab: SettingsDetailTab) => {
    onSelectTab(tab);
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.blur();
  };

  return (
    // Narrow viewports cannot centre it without running into the back button,
    // so it sits beside the button there and centres from `sm` up.
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-end pr-4 pl-32 sm:justify-center sm:px-16">
      <div className="pointer-events-auto relative w-full max-w-xs">
        <HugeiconsIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-fg"
          icon={Search01Icon}
        />
        <Input
          aria-activedescendant={
            isOpen && results[boundedIndex] !== undefined
              ? `settings-search-${results[boundedIndex].tab}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls="settings-search-results"
          aria-expanded={isOpen}
          aria-label="Search settings"
          autoComplete="off"
          className="h-9 pl-8 shadow-sm"
          onBlur={() => {
            setIsFocused(false);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setIsFocused(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              inputRef.current?.blur();
              return;
            }
            if (results.length === 0) {
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % results.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex(
                (current) => (current - 1 + results.length) % results.length
              );
              return;
            }
            if (event.key === "Enter") {
              const entry = results[boundedIndex];
              if (entry !== undefined) {
                event.preventDefault();
                selectTab(entry.tab);
              }
            }
          }}
          placeholder="Search settings"
          ref={inputRef}
          // ARIA 1.2 combobox: a native select cannot present ranked
          // destinations, and AGENTS.md forbids native select in app code.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="combobox"
          type="search"
          value={query}
        />

        {isOpen ? (
          <div
            className="squircle absolute inset-x-0 top-11 overflow-hidden rounded-md border border-border-strong bg-bg-surface shadow-lg"
            id="settings-search-results"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="listbox"
          >
            {results.length === 0 ? (
              <p className="px-3 py-2.5 text-body-sm text-muted-fg">
                No settings match that.
              </p>
            ) : (
              results.map((entry, index) => (
                <button
                  aria-selected={index === boundedIndex}
                  className={cn(
                    "block w-full px-3 py-2 text-left transition-colors",
                    {
                      "bg-accent": index === boundedIndex,
                    }
                  )}
                  id={`settings-search-${entry.tab}`}
                  key={entry.tab}
                  // Blur fires before click, so commit on mousedown instead.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectTab(entry.tab);
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                    onPrefetchTab(entry.tab);
                  }}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                  role="option"
                  type="button"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body-sm text-fg">
                      {entry.title}
                    </span>
                    <span className="shrink-0 text-micro text-muted-fg">
                      {entry.sectionLabel}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-micro text-muted-fg">
                    {entry.description}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
