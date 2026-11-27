"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { CheckIcon } from "./icons";
import { Kbd } from "./kbd";
import {
  menuEmptyClassName,
  menuGroupLabelClassName,
  menuItemClassName,
  menuListPaddingClassName,
  menuSurfaceClassName,
} from "./menu-chrome";
import { PopupMenuSearch } from "./popup-menu";

export type CommandMenuItem = {
  /** Set for multi-select lists; checked items show a trailing check. */
  checked?: boolean;
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
        chrome === "popup" ? menuSurfaceClassName : undefined,
        {
          "w-full": chrome === "dialog",
          "z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col":
            chrome === "popup",
        }
      )}
      data-blocking-overlay={chrome === "popup" ? "" : undefined}
    >
      {search === undefined ? null : (
        <PopupMenuSearch>{search}</PopupMenuSearch>
      )}
      <div
        aria-label={label}
        className={cn("overflow-y-auto", menuListPaddingClassName, {
          "max-h-64": chrome === "popup",
          "max-h-[min(24rem,56dvh)] overscroll-contain": isDialog,
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
                    aria-checked={item.checked}
                    aria-disabled={
                      item.disabledReason === undefined ? undefined : true
                    }
                    aria-selected={index === activeIndex}
                    className={cn(menuItemClassName, "group/command w-full", {
                      "data-disabled:pointer-events-auto":
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
                    {item.checked === true ? (
                      <CheckIcon className="size-3.5 shrink-0" />
                    ) : null}
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
            "flex items-center justify-between gap-4 border-t border-fg/10 px-4 py-2.5 text-micro text-muted-fg",
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
