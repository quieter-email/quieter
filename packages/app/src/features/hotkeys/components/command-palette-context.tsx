"use client";

import { KeyboardIcon } from "@hugeicons/core-free-icons";
import { useCreateStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/react-store";
import {
  createContext,
  use,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { PropsWithChildren } from "react";

import type { AppCommand } from "../domain/app-commands";
import { CommandPalette } from "./command-palette";

export type AppCommandRegistry = {
  deleteSource: (sourceId: string) => void;
  findCommand: (sourceId: string, commandId: string) => AppCommand | undefined;
  getContextLabel: () => string | undefined;
  getEntries: () => readonly (readonly [string, readonly AppCommand[]])[];
  requestOpen: () => void;
  registerOpen: (open: () => void) => () => void;
  setOpen: (open: boolean) => void;
  setSource: (
    sourceId: string,
    commands: readonly AppCommand[],
    contextLabel?: string
  ) => void;
  versionStore: Store<number>;
};

const CommandPaletteContext = createContext<AppCommandRegistry | null>(null);

export const useCommandPalette = () => use(CommandPaletteContext);

/**
 * `contextLabel` names the conversation or selection the commands act on. The
 * palette shows it once above the search field instead of on every row.
 */
export const useRegisterCommands = (
  commands: readonly AppCommand[],
  scopeKey: string,
  contextLabel?: string
) => {
  const registry = use(CommandPaletteContext);
  const registrationId = useId();
  const sourceId = `${registrationId}:${scopeKey}`;
  if (registry === null) {
    throw new Error(
      "Commands must be registered inside CommandPaletteProvider."
    );
  }

  useLayoutEffect(() => {
    registry.setSource(sourceId, commands, contextLabel);
  }, [commands, contextLabel, registry, sourceId]);

  useLayoutEffect(
    () => () => {
      registry.deleteSource(sourceId);
    },
    [registry, sourceId]
  );
};

const KeyboardHelpCommand = ({ onShow }: { onShow: () => void }) => {
  const commands = useMemo<readonly AppCommand[]>(
    () => [
      {
        execute: onShow,
        group: "Global",
        icon: KeyboardIcon,
        id: "show-keyboard-shortcuts",
        keywords: "help shortcuts keyboard",
        label: "Show keyboard shortcuts",
        shortcutId: "show-keyboard-shortcuts",
        state: "available",
      },
    ],
    [onShow]
  );
  useRegisterCommands(commands, "global");
  return null;
};

export const CommandPaletteProvider = ({
  children,
  onShowKeyboardShortcuts,
}: PropsWithChildren<{ onShowKeyboardShortcuts: () => void }>) => {
  const versionStore = useCreateStore(0);
  const stateStore = useCreateStore({
    entries: new Map<
      string,
      { commands: readonly AppCommand[]; contextLabel: string | undefined }
    >(),
    open: false,
  });
  const openPalette = useRef<(() => void) | undefined>(undefined);
  const registry = useMemo<AppCommandRegistry>(() => {
    const notify = () => {
      versionStore.setState((current) => current + 1);
    };
    return {
      deleteSource: (sourceId) => {
        const state = stateStore.get();
        if (state.entries.delete(sourceId) && state.open) {
          notify();
        }
      },
      findCommand: (sourceId, commandId) =>
        stateStore
          .get()
          .entries.get(sourceId)
          ?.commands.find((command) => command.id === commandId),
      getContextLabel: () =>
        [...stateStore.get().entries.values()]
          .map((entry) => entry.contextLabel)
          .findLast((label) => label !== undefined && label.length > 0),
      getEntries: () =>
        [...stateStore.get().entries].map(
          ([sourceId, entry]) => [sourceId, entry.commands] as const
        ),
      registerOpen: (open) => {
        openPalette.current = open;
        return () => {
          if (openPalette.current === open) {
            openPalette.current = undefined;
          }
        };
      },
      requestOpen: () => {
        if (!openPalette.current) {
          throw new Error("The command palette is unavailable.");
        }
        openPalette.current();
      },
      setOpen: (nextOpen) => {
        stateStore.get().open = nextOpen;
        if (nextOpen) {
          notify();
        }
      },
      setSource: (sourceId, commands, contextLabel) => {
        const state = stateStore.get();
        state.entries.set(sourceId, { commands, contextLabel });
        if (state.open) {
          notify();
        }
      },
      versionStore,
    };
  }, [stateStore, versionStore]);

  return (
    <CommandPaletteContext.Provider value={registry}>
      <KeyboardHelpCommand onShow={onShowKeyboardShortcuts} />
      {children}
      <CommandPalette registry={registry} />
    </CommandPaletteContext.Provider>
  );
};
