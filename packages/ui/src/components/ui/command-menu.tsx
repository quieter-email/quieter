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
  group: string;
  icon?: ReactNode;
  id: string;
  label: string;
};

export const CommandMenu = ({
  activeIndex,
  id,
  items,
  label = "Insert or format",
  onHighlight,
  onSelect,
  selectionHint = "insert",
  status,
}: {
  activeIndex: number;
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
      popupSurfaceClassName,
      "z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl"
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
        <p className={menuEmptyClassName}>
          {status ?? "No matching commands or snippets."}
        </p>
      ) : null}
      {items.map((item, index) => (
        <div key={item.id}>
          {index === 0 || items[index - 1]?.group !== item.group ? (
            <p className={menuGroupLabelClassName}>{item.group}</p>
          ) : null}
          <button
            aria-selected={index === activeIndex}
            className={cn(menuItemClassName, "w-full")}
            data-highlighted={index === activeIndex ? "" : undefined}
            id={`${id}-${index}`}
            onClick={() => {
              onSelect(index);
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
              <span className="block truncate">{item.label}</span>
              {item.description ? (
                <span className="block truncate text-caption text-muted-fg">
                  {item.description}
                </span>
              ) : null}
            </span>
          </button>
        </div>
      ))}
    </div>
    <div className="border-t border-fg/10 px-3 py-2 text-micro text-muted-fg">
      {status && items.length > 0 ? (
        <output className="block">{status}</output>
      ) : null}
      <p>↑↓ to browse, Enter to {selectionHint}, Esc to dismiss</p>
    </div>
  </div>
);
