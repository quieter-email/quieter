"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

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
  onHighlight,
  onSelect,
  status,
}: {
  activeIndex: number;
  id: string;
  items: CommandMenuItem[];
  onHighlight: (index: number) => void;
  onSelect: (index: number) => void;
  status?: string;
}) => (
  <div className="z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-fg shadow-lg">
    <div
      aria-label="Insert or format"
      className="max-h-64 overflow-y-auto p-1"
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Suggestions keep editor focus and support rich options.
      role="listbox"
    >
      {items.length === 0 ? (
        <p className="px-3 py-5 text-caption text-muted-fg">
          No matching commands or snippets.
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
            aria-selected={index === activeIndex}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
              {
                "bg-muted text-fg": index === activeIndex,
                "text-muted-fg": index !== activeIndex,
              }
            )}
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
              <span className="block truncate text-caption font-medium">
                {item.label}
              </span>
              {item.description ? (
                <span className="block truncate text-micro text-muted-fg">
                  {item.description}
                </span>
              ) : null}
            </span>
          </button>
        </div>
      ))}
    </div>
    <div className="border-t border-border px-3 py-2 text-micro text-muted-fg">
      {status ? <output className="block">{status}</output> : null}
      <p>↑↓ to browse, Enter to insert, Esc to dismiss</p>
    </div>
  </div>
);
