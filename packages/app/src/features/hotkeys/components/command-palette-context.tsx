"use client";

import { useCreateStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/react-store";
import { createContext, use, useId, useLayoutEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";

import type { AppCommand } from "../domain/app-commands";
import { CommandPalette } from "./command-palette";

export type AppCommandRegistry = Map<string, readonly AppCommand[]>;

const CommandPaletteContext = createContext<Store<AppCommandRegistry> | null>(
  null
);

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
    registry.setState((current) => new Map(current).set(sourceId, commands));
  }, [commands, registry, sourceId]);

  useLayoutEffect(
    () => () => {
      registry.setState((current) => {
        const next = new Map(current);
        next.delete(sourceId);
        return next;
      });
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
  const registry = useCreateStore<AppCommandRegistry>(new Map());

  return (
    <CommandPaletteContext.Provider value={registry}>
      <KeyboardHelpCommand onShow={onShowKeyboardShortcuts} />
      {children}
      <CommandPalette registry={registry} />
    </CommandPaletteContext.Provider>
  );
};
