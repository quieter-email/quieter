"use client";

import { KeyboardShortcutsDialog } from "@quieter/app/features/hotkeys/components/keyboard-shortcuts-dialog";
import {
  shouldIgnoreAppShortcut,
  trackAppShortcutSequenceContinuations,
} from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";

import { CommandPaletteProvider } from "./command-palette-context";

type KeyboardShortcutsContextValue = {
  closeKeyboardShortcuts: () => void;
  isKeyboardShortcutsOpen: boolean;
  openKeyboardShortcuts: () => void;
};

const KeyboardShortcutsContext =
  createContext<KeyboardShortcutsContextValue | null>(null);

export const KeyboardShortcutsProvider = ({ children }: PropsWithChildren) => {
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);

  useEffect(() => trackAppShortcutSequenceContinuations(), []);

  useHotkey(
    { key: "/", shift: true },
    (event) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      setIsKeyboardShortcutsOpen(true);
    },
    {
      ignoreInputs: true,
    }
  );

  const openKeyboardShortcuts = useCallback(() => {
    setIsKeyboardShortcutsOpen(true);
  }, []);

  const value = useMemo<KeyboardShortcutsContextValue>(
    () => ({
      closeKeyboardShortcuts: () => {
        setIsKeyboardShortcutsOpen(false);
      },
      isKeyboardShortcutsOpen,
      openKeyboardShortcuts,
    }),
    [isKeyboardShortcutsOpen, openKeyboardShortcuts]
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      <CommandPaletteProvider onShowKeyboardShortcuts={openKeyboardShortcuts}>
        {children}
      </CommandPaletteProvider>
      {isKeyboardShortcutsOpen ? (
        <KeyboardShortcutsDialog
          onOpenChange={setIsKeyboardShortcutsOpen}
          open={isKeyboardShortcutsOpen}
        />
      ) : null}
    </KeyboardShortcutsContext.Provider>
  );
};

export const useKeyboardShortcuts = () => {
  const context = use(KeyboardShortcutsContext);
  if (!context) {
    throw new Error(
      "useKeyboardShortcuts must be used within KeyboardShortcutsProvider."
    );
  }
  return context;
};
