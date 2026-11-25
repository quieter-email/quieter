"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";
import { Kbd } from "./kbd";
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
  search,
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
  search?: ReactNode;
  selectionHint?: "insert" | "select" | false;
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

  const isDialog = chrome === "dialog";
  const footerStatus = items.length > 0 ? status : undefined;
  const showFooter = selectionHint !== false || Boolean(footerStatus);
  const selectionLabel = selectionHint === "insert" ? "Insert" : "Select";

  return (
    <div
      className={cn(
        "overflow-hidden",
        chrome === "popup" ? popupSurfaceClassName : undefined,
        {
          "w-full": chrome === "dialog",
          "z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-xl":
            chrome === "popup",
        }
      )}
      data-blocking-overlay={chrome === "popup" ? "" : undefined}
    >
      {search === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2 border-b border-fg/10 px-3.5">
          <Icon aria-hidden icon={Search01Icon} tone="muted" />
          {search}
        </div>
      )}
      <div
        aria-label={label}
        className={cn("overflow-y-auto", {
          "max-h-64 p-1": chrome === "popup",
          "max-h-[min(24rem,56dvh)] overscroll-contain p-1.5": isDialog,
        })}
        id={id}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Suggestions keep editor focus and support rich options.
        role="listbox"
      >
        {items.length === 0 ? (
          <p
            className={cn(menuEmptyClassName, {
              "py-10 text-center": isDialog,
            })}
          >
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
                  className={
                    isDialog
                      ? cn("px-2.5 pb-1 text-micro font-medium text-muted-fg", {
                          "pt-1": sectionIndex === 0,
                          "pt-2.5": sectionIndex > 0,
                        })
                      : menuGroupLabelClassName
                  }
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
                    className={cn(menuItemClassName, "group/command w-full", {
                      "active:scale-100 data-disabled:pointer-events-auto":
                        item.disabledReason !== undefined,
                      "min-h-9 gap-2.5 rounded-lg px-2.5 py-2": isDialog,
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
                      <span
                        className={cn("flex shrink-0 [&_svg]:size-4", {
                          "text-muted-fg group-data-highlighted/command:text-fg":
                            isDialog &&
                            !(
                              item.tone === "destructive" &&
                              item.disabledReason === undefined
                            ),
                        })}
                      >
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
      {showFooter && isDialog ? (
        <div
          className={cn(
            "flex items-center justify-between gap-4 border-t border-fg/10 bg-section/60 px-4 py-2.5 text-micro text-muted-fg",
            { "max-sm:hidden": !footerStatus }
          )}
        >
          {footerStatus ? (
            <output className="min-w-0 truncate">{footerStatus}</output>
          ) : (
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  <Kbd size="sm">↑</Kbd>
                  <Kbd size="sm">↓</Kbd>
                </span>
                Navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd size="sm">↵</Kbd>
                {selectionLabel}
              </span>
            </span>
          )}
          {selectionHint === false ? null : (
            <span className="flex shrink-0 items-center gap-1.5 max-sm:hidden">
              <Kbd size="sm">Esc</Kbd>
              Close
            </span>
          )}
        </div>
      ) : null}
      {showFooter && !isDialog ? (
        <div className="border-t border-fg/10 px-3 py-2 text-micro text-muted-fg">
          {footerStatus ? (
            <output className="block">{footerStatus}</output>
          ) : null}
          {selectionHint === false ? null : (
            <p>↑↓ to browse, Enter to {selectionHint}, Esc to dismiss</p>
          )}
        </div>
      ) : null}
    </div>
  );
};
