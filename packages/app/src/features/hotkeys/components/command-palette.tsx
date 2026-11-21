"use client";

import { APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR } from "@quieter/app/features/hotkeys/domain/hotkey-guards";
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
import { detectPlatform } from "@tanstack/hotkeys";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useSelector } from "@tanstack/react-store";
import type { Store } from "@tanstack/react-store";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";

import {
  getShortcutDisplay,
  KEYBOARD_SHORTCUTS,
} from "../domain/keyboard-shortcuts";
import type { AppCommandRegistry } from "./command-palette-context";

const COMMAND_GROUP_ORDER: ReadonlyMap<string, number> = new Map([
  ["Conversation actions", 0],
  ["Mail", 1],
  ["Conversations", 2],
  ["Views", 3],
  ["Navigation", 4],
  ["Accounts", 5],
  ["Global", 6],
]);

const shortcutById = new Map(
  KEYBOARD_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut])
);

const subscribeToPlatform = () => () => {
  // The operating system does not change during a page's lifetime.
};

const hasBlockingOverlayOutsidePalette = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR
    ),
  ].some((overlay) => !Object.hasOwn(overlay.dataset, "commandPaletteDialog"));

const CommandPaletteBody = ({
  inputRef,
  onSelectCommand,
  open,
  registry,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onSelectCommand: (sourceId: string, commandId: string) => void;
  open: boolean;
  registry: Store<AppCommandRegistry>;
}) => {
  const registrations = useSelector(registry, (state) => state);
  const platform = useSyncExternalStore(
    subscribeToPlatform,
    detectPlatform,
    () => "windows" as const
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = useId();
  const searchTokens = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const commands = [...registrations].flatMap(([sourceId, items]) =>
    items.map((command) => ({ command, sourceId }))
  );
  const filtered = commands
    .filter(({ command }) => {
      if (searchTokens.length === 0) {
        return true;
      }
      const haystack =
        `${command.label} ${command.group} ${command.description ?? ""} ${command.keywords ?? ""}`.toLocaleLowerCase();
      return searchTokens.every((token) => haystack.includes(token));
    })
    .toSorted((left, right) => {
      const leftOrder = COMMAND_GROUP_ORDER.get(left.command.group) ?? 99;
      const rightOrder = COMMAND_GROUP_ORDER.get(right.command.group) ?? 99;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      const groupCompare = left.command.group.localeCompare(
        right.command.group
      );
      if (groupCompare !== 0) {
        return groupCompare;
      }
      if (left.command.state !== right.command.state) {
        return left.command.state === "available" ? -1 : 1;
      }
      return (
        left.command.label.localeCompare(right.command.label) ||
        left.command.id.localeCompare(right.command.id)
      );
    });
  const highlightedIndex = Math.min(
    activeIndex,
    Math.max(0, filtered.length - 1)
  );

  const selectCommand = (index: number) => {
    const selected = filtered[index];
    if (selected === undefined || selected.command.state !== "available") {
      return;
    }
    onSelectCommand(selected.sourceId, selected.command.id);
  };

  return (
    <>
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
          const shortcut =
            command.shortcutId === undefined
              ? undefined
              : shortcutById.get(command.shortcutId);
          return {
            ...command,
            disabledReason:
              command.state === "unavailable" ? command.reason : undefined,
            id: `${sourceId}-${command.id}`,
            shortcut:
              shortcut === undefined ? undefined : (
                <Kbd aria-hidden variant="hint">
                  {getShortcutDisplay(shortcut, platform)[0]?.join(" → ")}
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
    </>
  );
};

export const CommandPalette = ({
  registry,
}: {
  registry: Store<AppCommandRegistry>;
}) => {
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingCommandRef = useRef<{
    commandId: string;
    sourceId: string;
  } | null>(null);

  useHotkey(
    "Mod+Shift+K",
    (event) => {
      if (event.isComposing || event.defaultPrevented) {
        return;
      }
      if (open) {
        if (hasBlockingOverlayOutsidePalette()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        pendingCommandRef.current = null;
        setOpen(false);
        return;
      }
      if (document.querySelector(APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      pendingCommandRef.current = null;
      setSessionKey((current) => current + 1);
      setOpen(true);
    },
    { ignoreInputs: false, preventDefault: false, stopPropagation: false }
  );

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
        data-command-palette-dialog
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
        <CommandPaletteBody
          inputRef={inputRef}
          key={sessionKey}
          onSelectCommand={(sourceId, commandId) => {
            pendingCommandRef.current = { commandId, sourceId };
            setOpen(false);
          }}
          open={open}
          registry={registry}
        />
        <DialogFooter>
          <DialogCloseButton variant="default">Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
