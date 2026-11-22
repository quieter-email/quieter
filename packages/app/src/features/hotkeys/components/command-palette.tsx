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
import { toast } from "@quieter/ui/toast";
import { detectPlatform } from "@tanstack/hotkeys";
import type { RegisterableHotkey } from "@tanstack/react-hotkeys";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useSelector } from "@tanstack/react-store";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RefObject } from "react";

import type { AppCommand } from "../domain/app-commands";
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

const commandPaletteShortcut = shortcutById.get("show-command-palette");
const commandPaletteHotkey: RegisterableHotkey =
  commandPaletteShortcut !== undefined &&
  "keys" in commandPaletteShortcut &&
  commandPaletteShortcut.keys[0] !== undefined
    ? commandPaletteShortcut.keys[0]
    : "Mod+Shift+K";

const subscribeToPlatform = () => () => {
  // The operating system does not change during a page's lifetime.
};

const hasBlockingOverlayOutsidePalette = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR
    ),
  ].some((overlay) => !Object.hasOwn(overlay.dataset, "commandPaletteDialog"));

const getCommandMatchRank = (
  command: AppCommand,
  normalizedQuery: string,
  searchTokens: readonly string[]
) => {
  const labelText = command.label.toLocaleLowerCase();
  if (labelText.startsWith(normalizedQuery)) {
    return 0;
  }
  if (searchTokens.every((token) => labelText.includes(token))) {
    return 1;
  }
  if (searchTokens.some((token) => labelText.includes(token))) {
    return 2;
  }
  return 3;
};

const CommandPaletteBody = ({
  inputRef,
  onSelectCommand,
  open,
  registry,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onSelectCommand: (sourceId: string, commandId: string) => void;
  open: boolean;
  registry: AppCommandRegistry;
}) => {
  useSelector(registry.versionStore, (version) => version);
  const platform = useSyncExternalStore(
    subscribeToPlatform,
    detectPlatform,
    () => "windows" as const
  );
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const menuId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchTokens = normalizedQuery
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const isSearching = searchTokens.length > 0;
  const allEntries = registry.getEntries().flatMap(([sourceId, items]) =>
    items.map((command) => ({
      command,
      key: `${sourceId}:${command.id}`,
      sourceId,
    }))
  );
  const primaryIds = new Set(
    allEntries
      .filter(({ command }) => command.fallback !== true)
      .map(({ command }) => command.id)
  );
  const commands = allEntries.filter(
    ({ command }) => command.fallback !== true || !primaryIds.has(command.id)
  );
  const matched = commands.filter(({ command }) => {
    if (!isSearching) {
      return true;
    }
    const haystack =
      `${command.label} ${command.group} ${command.keywords ?? ""}`.toLocaleLowerCase();
    return searchTokens.every((token) => haystack.includes(token));
  });
  const availableGroups = new Set(
    matched
      .filter(({ command }) => command.state === "available")
      .map(({ command }) => command.group)
  );
  const filtered = matched.toSorted((left, right) => {
    if (isSearching) {
      if (left.command.state !== right.command.state) {
        return left.command.state === "available" ? -1 : 1;
      }
      const leftRank = getCommandMatchRank(
        left.command,
        normalizedQuery,
        searchTokens
      );
      const rightRank = getCommandMatchRank(
        right.command,
        normalizedQuery,
        searchTokens
      );
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
    } else {
      const leftHasAvailable = availableGroups.has(left.command.group);
      const rightHasAvailable = availableGroups.has(right.command.group);
      if (leftHasAvailable !== rightHasAvailable) {
        return leftHasAvailable ? -1 : 1;
      }
    }
    const leftOrder = COMMAND_GROUP_ORDER.get(left.command.group) ?? 99;
    const rightOrder = COMMAND_GROUP_ORDER.get(right.command.group) ?? 99;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    const groupCompare = left.command.group.localeCompare(right.command.group);
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
  const activeKeyIndex =
    activeKey === null
      ? -1
      : filtered.findIndex((entry) => entry.key === activeKey);
  const firstAvailableIndex = filtered.findIndex(
    (entry) => entry.command.state === "available"
  );
  let highlightedIndex = 0;
  if (activeKeyIndex !== -1) {
    highlightedIndex = activeKeyIndex;
  } else if (firstAvailableIndex !== -1) {
    highlightedIndex = firstAvailableIndex;
  }

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
            setActiveKey(null);
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
                const nextEntry = filtered[next];
                if (nextEntry !== undefined) {
                  setActiveKey(nextEntry.key);
                }
                document
                  .querySelector(`[id=${JSON.stringify(`${menuId}-${next}`)}]`)
                  ?.scrollIntoView?.({ block: "nearest" });
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
        onHighlight={(index) => {
          const entry = filtered[index];
          if (entry !== undefined) {
            setActiveKey(entry.key);
          }
        }}
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
  registry: AppCommandRegistry;
}) => {
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const skipReturnFocusRef = useRef(false);
  const dispatchFrameRef = useRef<number | null>(null);
  const pendingCommandRef = useRef<{
    commandId: string;
    sourceId: string;
  } | null>(null);

  const cancelPendingDispatch = () => {
    if (dispatchFrameRef.current !== null) {
      cancelAnimationFrame(dispatchFrameRef.current);
      dispatchFrameRef.current = null;
    }
  };

  useLayoutEffect(() => {
    registry.setOpen(open);
  }, [open, registry]);

  useEffect(() => cancelPendingDispatch, []);

  useHotkey(
    commandPaletteHotkey,
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
        cancelPendingDispatch();
        pendingCommandRef.current = null;
        skipReturnFocusRef.current = false;
        registry.setOpen(false);
        setOpen(false);
        return;
      }
      if (document.querySelector(APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cancelPendingDispatch();
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      pendingCommandRef.current = null;
      skipReturnFocusRef.current = false;
      registry.setOpen(true);
      setSessionKey((current) => current + 1);
      setOpen(true);
    },
    { ignoreInputs: false, preventDefault: false, stopPropagation: false }
  );

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          cancelPendingDispatch();
          skipReturnFocusRef.current = false;
        }
        registry.setOpen(nextOpen);
        setOpen(nextOpen);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) {
          return;
        }
        const pending = pendingCommandRef.current;
        pendingCommandRef.current = null;
        if (pending === null) {
          return;
        }
        cancelPendingDispatch();
        dispatchFrameRef.current = requestAnimationFrame(() => {
          dispatchFrameRef.current = null;
          const command = registry.findCommand(
            pending.sourceId,
            pending.commandId
          );
          if (command?.state === "available") {
            void (async () => {
              try {
                await command.execute();
              } catch (error) {
                toastError(error, { boundary: "command-palette" });
              }
            })();
          } else {
            toast.info(
              command?.state === "unavailable"
                ? command.reason
                : "Action cancelled because the view changed."
            );
          }
        });
      }}
      open={open}
    >
      <DialogContent
        data-command-palette-dialog
        finalFocus={() => {
          if (skipReturnFocusRef.current) {
            return false;
          }
          return returnFocusRef.current?.isConnected === true
            ? returnFocusRef.current
            : false;
        }}
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
            skipReturnFocusRef.current = true;
            pendingCommandRef.current = { commandId, sourceId };
            registry.setOpen(false);
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
