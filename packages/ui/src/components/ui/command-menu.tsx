"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import {
  menuEmptyClassName,
  menuGroupLabelClassName,
  menuItemClassName,
} from "./menu-chrome";
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
}) => {
  const sections: {
    entries: { index: number; item: CommandMenuItem }[];
    group: string;
  }[] = [];
  for (const [index, item] of items.entries()) {
    const previous = sections.at(-1);
    if (previous?.group === item.group) {
      previous.entries.push({ index, item });
    } else {
      sections.push({ entries: [{ index, item }], group: item.group });
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden",
        chrome === "popup" ? popupSurfaceClassName : undefined,
        {
          "w-full": chrome === "dialog",
          "z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl": chrome === "popup",
        }
      )}
      data-blocking-overlay={chrome === "popup" ? "" : undefined}
    >
      <div
        aria-label={label}
        className={cn("max-h-64 overflow-y-auto", {
          "p-1": chrome === "popup",
          "px-1.5 py-1": chrome === "dialog",
        })}
        id={id}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Suggestions keep editor focus and support rich options.
        role="listbox"
      >
        {items.length === 0 ? (
          <p className={menuEmptyClassName}>
            {status ?? "No matching commands or snippets."}
          </p>
        ) : (
          sections.map((section, sectionIndex) => {
            const groupLabelId = `${id}-group-${sectionIndex}`;
            return (
              <div
                aria-labelledby={groupLabelId}
                key={`${section.group}-${section.entries[0]?.item.id ?? ""}`}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Custom listbox groups require role="group" on a div container.
                role="group"
              >
                <div
                  className={menuGroupLabelClassName}
                  id={groupLabelId}
                  role="presentation"
                >
                  {section.group}
                </div>
                {section.entries.map(({ index, item }) => (
                  <button
                    aria-disabled={
                      item.disabledReason === undefined ? undefined : true
                    }
                    aria-selected={index === activeIndex}
                    className={cn(menuItemClassName, "w-full", {
                      "active:scale-100 data-disabled:pointer-events-auto":
                        item.disabledReason !== undefined,
                      "text-destructive":
                        item.tone === "destructive" &&
                        item.disabledReason === undefined,
                    })}
                    data-disabled={
                      item.disabledReason === undefined ? undefined : ""
                    }
                    data-highlighted={index === activeIndex ? "" : undefined}
                    id={`${id}-${index}`}
                    key={item.id}
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
                      <span className="shrink-0 [&_svg]:size-4">
                        {item.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {(item.disabledReason ?? item.description) ? (
                        <span
                          className={cn("block text-caption text-muted-fg", {
                            truncate: item.disabledReason === undefined,
                          })}
                        >
                          {item.disabledReason ?? item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.shortcut}
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
      <div
        className={cn("border-t border-fg/10 py-2 text-micro text-muted-fg", {
          "px-3": chrome === "popup",
          "px-4": chrome === "dialog",
        })}
      >
        {status && items.length > 0 ? (
          <output className="block">{status}</output>
        ) : null}
        <p>↑↓ to browse, Enter to {selectionHint}, Esc to dismiss</p>
      </div>
    </div>
  );
};
