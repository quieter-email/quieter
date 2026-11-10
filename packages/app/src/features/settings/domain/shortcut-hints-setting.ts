"use client";

import { useSyncExternalStore } from "react";

const SHORTCUT_HINTS_STORAGE_KEY = "quieter:shortcut-hints-enabled";
const SHORTCUT_HINTS_CHANGE_EVENT = "quieter:shortcut-hints-enabled-change";
let volatileChoice: boolean | undefined;

const readShortcutHintsEnabled = () => {
  if (typeof window === "undefined") {
    return true;
  }
  if (volatileChoice !== undefined) {
    return volatileChoice;
  }
  try {
    return window.localStorage.getItem(SHORTCUT_HINTS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

const subscribeToShortcutHintsEnabled = (onStoreChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== SHORTCUT_HINTS_STORAGE_KEY && event.key !== null) {
      return;
    }
    volatileChoice = undefined;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(SHORTCUT_HINTS_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SHORTCUT_HINTS_CHANGE_EVENT, onStoreChange);
  };
};

export const setShortcutHintsEnabled = (enabled: boolean) => {
  try {
    window.localStorage.setItem(SHORTCUT_HINTS_STORAGE_KEY, String(enabled));
    volatileChoice = undefined;
  } catch {
    volatileChoice = enabled;
  }
  window.dispatchEvent(new Event(SHORTCUT_HINTS_CHANGE_EVENT));
};

export const useShortcutHintsEnabled = () =>
  useSyncExternalStore(
    subscribeToShortcutHintsEnabled,
    readShortcutHintsEnabled,
    () => true
  );
