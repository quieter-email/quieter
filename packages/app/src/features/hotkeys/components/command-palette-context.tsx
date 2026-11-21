"use client";

import { useCreateStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/react-store";
import { createContext, use, useId, useLayoutEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";

import type { AppCommand } from "../domain/app-commands";
import { CommandPalette } from "./command-palette";

export type AppCommandRegistry = {
  deleteSource: (sourceId: string) => void;
  findCommand: (sourceId: string, commandId: string) => AppCommand | undefined;
  getEntries: () => readonly (readonly [string, readonly AppCommand[]])[];
  setOpen: (open: boolean) => void;
  setSource: (sourceId: string, commands: readonly AppCommand[]) => void;
  versionStore: Store<number>;
};

const CommandPaletteContext = createContext<AppCommandRegistry | null>(null);

export const useRegisterCommands = (
  commands: readonly AppCommand[],
  scopeKey: string
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
    registry.setSource(sourceId, commands);
  }, [commands, registry, sourceId]);

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
    entries: new Map<string, readonly AppCommand[]>(),
    open: false,
  });
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
          ?.find((command) => command.id === commandId),
      getEntries: () => [...stateStore.get().entries],
      setOpen: (nextOpen) => {
        stateStore.get().open = nextOpen;
        if (nextOpen) {
          notify();
        }
      },
      setSource: (sourceId, commands) => {
        const state = stateStore.get();
        state.entries.set(sourceId, commands);
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
