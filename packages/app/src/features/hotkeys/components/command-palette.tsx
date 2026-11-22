"use client";

import {
  Cancel01Icon,
  Mail01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR } from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import { CommandMenu } from "@quieter/ui/command-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
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
  const contextLabel = registry.getContextLabel();
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
      <div className="border-b border-fg/10">
        {contextLabel === undefined ? null : (
          <div className="flex min-w-0 items-center gap-1.5 px-4 pt-3 text-caption text-muted-fg">
            <Icon icon={Mail01Icon} size={14} />
            <span className="truncate">{contextLabel}</span>
          </div>
        )}
        <div className="flex items-center gap-2.5 pr-3 pl-4">
          <Icon icon={Search01Icon} tone="muted" />
          <Input
            aria-activedescendant={
              filtered.length > 0 ? `${menuId}-${highlightedIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={menuId}
            aria-expanded={open}
            aria-label="Search commands"
            chrome="command"
            className="flex-1"
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
                    .querySelector(
                      `[id=${JSON.stringify(`${menuId}-${next}`)}]`
                    )
                    ?.scrollIntoView?.({ block: "nearest" });
                }
              } else if (event.key === "Enter") {
                event.preventDefault();
                selectCommand(highlightedIndex);
              }
            }}
            placeholder="Type a command or search..."
            ref={inputRef}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Input renders an input with an external command listbox.
            role="combobox"
            value={query}
          />
          {query.length > 0 ? (
            <IconButtonTooltip label="Clear search">
              <Button
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setActiveKey(null);
                  inputRef.current?.focus();
                }}
                size="icon-xs"
                variant="ghost"
              >
                <Icon icon={Cancel01Icon} />
              </Button>
            </IconButtonTooltip>
          ) : null}
          <DialogClose aria-label="Close commands" className="sm:hidden">
            Close
          </DialogClose>
        </div>
      </div>
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
            icon:
              command.icon === undefined ? undefined : (
                <Icon icon={command.icon} />
              ),
            id: `${sourceId}-${command.id}`,
            shortcut:
              shortcut === undefined ? undefined : (
                <span aria-hidden className="flex shrink-0 items-center gap-1">
                  {getShortcutDisplay(shortcut, platform)[0]?.map(
                    (key, keyIndex, steps) => (
                      <span
                        className="flex items-center gap-1"
                        key={steps.slice(0, keyIndex + 1).join(" ")}
                      >
                        {keyIndex > 0 ? (
                          <span className="text-micro text-muted-fg">→</span>
                        ) : null}
                        <Kbd size="sm">{key}</Kbd>
                      </span>
                    )
                  )}
                </span>
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
        variant="command"
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <DialogDescription className="sr-only">
          Find an action for your current view.
        </DialogDescription>
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
      </DialogContent>
    </Dialog>
  );
};
