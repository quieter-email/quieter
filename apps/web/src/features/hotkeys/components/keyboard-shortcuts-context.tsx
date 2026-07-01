"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import { createContext, type PropsWithChildren, use, useState } from "react";
import { shouldIgnoreAppShortcut } from "~/features/hotkeys/domain/hotkey-guards";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";

type KeyboardShortcutsContextValue = {
  closeKeyboardShortcuts: () => void;
  isKeyboardShortcutsOpen: boolean;
  openKeyboardShortcuts: () => void;
};

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

export const KeyboardShortcutsProvider = ({ children }: PropsWithChildren) => {
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);

  useHotkey(
    { key: "/", shift: true },
    (event) => {
      if (shouldIgnoreAppShortcut(event)) return;
      setIsKeyboardShortcutsOpen(true);
    },
    {
      ignoreInputs: true,
    },
  );

  const value: KeyboardShortcutsContextValue = {
    closeKeyboardShortcuts: () => setIsKeyboardShortcutsOpen(false),
    isKeyboardShortcutsOpen,
    openKeyboardShortcuts: () => setIsKeyboardShortcutsOpen(true),
  };

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
      <KeyboardShortcutsDialog
        onOpenChange={setIsKeyboardShortcutsOpen}
        open={isKeyboardShortcutsOpen}
      />
    </KeyboardShortcutsContext.Provider>
  );
};

export const useKeyboardShortcuts = () => {
  const context = use(KeyboardShortcutsContext);
  if (!context) {
    throw new Error("useKeyboardShortcuts must be used within KeyboardShortcutsProvider.");
  }
  return context;
};
