"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import { createContext, lazy, Suspense, use, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import { shouldIgnoreAppShortcut } from "#/features/hotkeys/domain/hotkey-guards";

const KeyboardShortcutsDialog = lazy(
  async () =>
    await import("./keyboard-shortcuts-dialog").then(
      ({ KeyboardShortcutsDialog: Component }) => ({
        default: Component,
      })
    )
);

type KeyboardShortcutsContextValue = {
  closeKeyboardShortcuts: () => void;
  isKeyboardShortcutsOpen: boolean;
  openKeyboardShortcuts: () => void;
};

const KeyboardShortcutsContext =
  createContext<KeyboardShortcutsContextValue | null>(null);

export const KeyboardShortcutsProvider = ({ children }: PropsWithChildren) => {
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);

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

  const value = useMemo<KeyboardShortcutsContextValue>(
    () => ({
      closeKeyboardShortcuts: () => {
        setIsKeyboardShortcutsOpen(false);
      },
      isKeyboardShortcutsOpen,
      openKeyboardShortcuts: () => {
        setIsKeyboardShortcutsOpen(true);
      },
    }),
    [isKeyboardShortcutsOpen]
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
      {isKeyboardShortcutsOpen ? (
        <Suspense fallback={null}>
          <KeyboardShortcutsDialog
            onOpenChange={setIsKeyboardShortcutsOpen}
            open={isKeyboardShortcutsOpen}
          />
        </Suspense>
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
