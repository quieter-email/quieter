"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { popupSurfaceClassName } from "./popup-surface";

export type CommandMenuItem = {
  description?: string;
  disabledReason?: string;
  group: string;
  icon?: ReactNode;
  id: string;
  label: string;
  shortcut?: ReactNode;
  tone?: "destructive";
};

export const CommandMenu = ({
  activeIndex,
  chrome = "popup",
  id,
  items,
  label = "Insert or format",
  onHighlight,
  onSelect,
  selectionHint = "insert",
  status,
}: {
  activeIndex: number;
  chrome?: "dialog" | "popup";
  id: string;
  items: CommandMenuItem[];
  label?: string;
  onHighlight: (index: number) => void;
  onSelect: (index: number) => void;
  selectionHint?: "insert" | "select";
  status?: string;
}) => (
  <div
    className={cn(
      "overflow-hidden",
      chrome === "popup" ? popupSurfaceClassName : undefined,
      {
        "w-full": chrome === "dialog",
        "z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl": chrome === "popup",
      }
    )}
  >
    <div
      aria-label={label}
      className="max-h-64 overflow-y-auto p-1"
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Suggestions keep editor focus and support rich options.
      role="listbox"
    >
      {items.length === 0 ? (
        <p className="px-3 py-5 text-caption text-muted-fg">
          {status ?? "No matching commands or snippets."}
        </p>
      ) : null}
      {items.map((item, index) => (
        <div key={item.id}>
          {index === 0 || items[index - 1]?.group !== item.group ? (
            <p className="px-2 pt-2 pb-1 text-micro font-medium text-muted-fg">
              {item.group}
            </p>
          ) : null}
          <button
            aria-disabled={item.disabledReason === undefined ? undefined : true}
            aria-describedby={
              (item.disabledReason ?? item.description)
                ? `${id}-${index}-description`
                : undefined
            }
            aria-selected={index === activeIndex}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
              {
                "bg-muted": index === activeIndex,
                "text-destructive":
                  item.tone === "destructive" &&
                  item.disabledReason === undefined,
                "text-fg": index === activeIndex && item.tone !== "destructive",
                "text-muted-fg":
                  item.disabledReason !== undefined ||
                  (index !== activeIndex && item.tone !== "destructive"),
              }
            )}
            id={`${id}-${index}`}
            onClick={() => {
              if (item.disabledReason === undefined) {
                onSelect(index);
              }
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onPointerMove={() => {
              onHighlight(index);
            }}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Suggestions keep editor focus and support rich options.
            role="option"
            tabIndex={-1}
            type="button"
          >
            {item.icon === undefined ? null : (
              <span className="shrink-0 [&_svg]:size-4">{item.icon}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-caption font-medium">
                {item.label}
              </span>
              {(item.disabledReason ?? item.description) ? (
                <span
                  className={cn("block text-micro text-muted-fg", {
                    truncate: item.disabledReason === undefined,
                  })}
                  id={`${id}-${index}-description`}
                >
                  {item.disabledReason ?? item.description}
                </span>
              ) : null}
            </span>
            {item.shortcut}
          </button>
        </div>
      ))}
    </div>
    <div className="border-t border-border px-3 py-2 text-micro text-muted-fg">
      {status && items.length > 0 ? (
        <output className="block">{status}</output>
      ) : null}
      <p>↑↓ to browse, Enter to {selectionHint}, Esc to dismiss</p>
    </div>
  </div>
);
