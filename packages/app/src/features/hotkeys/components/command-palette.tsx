"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { CommandMenu } from "@quieter/ui/command-menu";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Input } from "@quieter/ui/input";
import { Kbd } from "@quieter/ui/kbd";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useSelector } from "@tanstack/react-store";
import type { Store } from "@tanstack/react-store";
import { useId, useRef, useState } from "react";

import {
  getShortcutDisplay,
  KEYBOARD_SHORTCUTS,
} from "../domain/keyboard-shortcuts";
import type { AppCommandRegistry } from "./command-palette-context";

export const CommandPalette = ({
  registry,
}: {
  registry: Store<AppCommandRegistry>;
}) => {
  const registrations = useSelector(registry, (state) => state);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingCommandRef = useRef<{
    commandId: string;
    sourceId: string;
  } | null>(null);
  const menuId = useId();
  const search = query.trim().toLocaleLowerCase();
  const commands = [...registrations].flatMap(([sourceId, items]) =>
    items.map((command) => ({ command, sourceId }))
  );
  const filtered = commands
    .filter(({ command }) =>
      `${command.label} ${command.group} ${command.description ?? ""} ${command.keywords ?? ""}`
        .toLocaleLowerCase()
        .includes(search)
    )
    .toSorted(
      (left, right) =>
        left.command.group.localeCompare(right.command.group) ||
        left.command.label.localeCompare(right.command.label) ||
        left.command.id.localeCompare(right.command.id)
    );
  const highlightedIndex = Math.min(
    activeIndex,
    Math.max(0, filtered.length - 1)
  );

  useHotkey(
    "Mod+Shift+K",
    (event) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector(
          "[role='dialog'], [data-popup-open][aria-haspopup], [data-popup-open][role='combobox']"
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      pendingCommandRef.current = null;
      setQuery("");
      setActiveIndex(0);
      setOpen(true);
    },
    { ignoreInputs: false, preventDefault: false, stopPropagation: false }
  );

  const selectCommand = (index: number) => {
    const selected = filtered[index];
    if (selected === undefined || selected.command.state !== "available") {
      return;
    }
    pendingCommandRef.current = {
      commandId: selected.command.id,
      sourceId: selected.sourceId,
    };
    setOpen(false);
  };

  return (
    <Dialog
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) {
          return;
        }
        const pending = pendingCommandRef.current;
        pendingCommandRef.current = null;
        if (pending === null) {
          return;
        }
        requestAnimationFrame(() => {
          const command = registry
            .get()
            .get(pending.sourceId)
            ?.find((item) => item.id === pending.commandId);
          if (command?.state === "available") {
            void (async () => {
              try {
                await command.execute();
              } catch (error) {
                toastError(error, { boundary: "command-palette" });
              }
            })();
          }
        });
      }}
      open={open}
    >
      <DialogContent
        finalFocus={() =>
          returnFocusRef.current?.isConnected === true
            ? returnFocusRef.current
            : false
        }
        initialFocus={inputRef}
      >
        <DialogHeader>
          <DialogTitle>Commands</DialogTitle>
          <DialogDescription>
            Find an action for your current view.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Input
            aria-activedescendant={
              filtered.length > 0 ? `${menuId}-${highlightedIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={menuId}
            aria-expanded={open}
            aria-label="Search commands"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const count = filtered.length;
                if (count > 0) {
                  const next =
                    (highlightedIndex +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      count) %
                    count;
                  setActiveIndex(next);
                  document
                    .querySelector(`#${CSS.escape(`${menuId}-${next}`)}`)
                    ?.scrollIntoView({ block: "nearest" });
                }
              } else if (event.key === "Enter") {
                event.preventDefault();
                selectCommand(highlightedIndex);
              }
            }}
            placeholder="Search commands..."
            ref={inputRef}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Input renders an input with an external command listbox.
            role="combobox"
            value={query}
          />
        </DialogBody>
        <CommandMenu
          activeIndex={highlightedIndex}
          chrome="dialog"
          id={menuId}
          items={filtered.map(({ command, sourceId }) => {
            const shortcut = KEYBOARD_SHORTCUTS.find(
              (item) => item.id === command.shortcutId
            );
            return {
              ...command,
              disabledReason:
                command.state === "unavailable" ? command.reason : undefined,
              id: `${sourceId}-${command.id}`,
              shortcut:
                shortcut === undefined ? undefined : (
                  <Kbd variant="hint">
                    {getShortcutDisplay(shortcut)[0]?.join(" then ")}
                  </Kbd>
                ),
            };
          })}
          label="Available commands"
          onHighlight={setActiveIndex}
          onSelect={selectCommand}
          selectionHint="select"
          status={filtered.length === 0 ? "No matching commands." : undefined}
        />
        <DialogFooter>
          <DialogCloseButton variant="default">Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
