"use client";

import { useSyncExternalStore } from "react";
import { clientEnv } from "~/env";

const MANAGED_DEMO_MODE_STORAGE_KEY = "quieter:managed-demo-mode-enabled";
const MANAGED_DEMO_MODE_CHANGE_EVENT = "quieter:managed-demo-mode-enabled-change";
const GMAIL_DEMO_MODE_STORAGE_KEY = "quieter:demo-mode-enabled";
const GMAIL_DEMO_MODE_CHANGE_EVENT = "quieter:demo-mode-enabled-change";

export const isManagedDemoModeAvailable = () =>
  import.meta.env.DEV || clientEnv.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED === "true";

const readManagedDemoModeEnabled = () => {
  if (!isManagedDemoModeAvailable() || typeof window === "undefined") return false;
  return window.localStorage.getItem(MANAGED_DEMO_MODE_STORAGE_KEY) === "true";
};

const subscribeToManagedDemoMode = (callback: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === MANAGED_DEMO_MODE_STORAGE_KEY) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(MANAGED_DEMO_MODE_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(MANAGED_DEMO_MODE_CHANGE_EVENT, callback);
  };
};

const disableGmailDemoMode = () => {
  window.localStorage.setItem(GMAIL_DEMO_MODE_STORAGE_KEY, "false");
  window.dispatchEvent(new Event(GMAIL_DEMO_MODE_CHANGE_EVENT));
};

export const setManagedDemoModeEnabled = (enabled: boolean) => {
  if (!isManagedDemoModeAvailable()) return;

  if (enabled) {
    disableGmailDemoMode();
  }

  window.localStorage.setItem(MANAGED_DEMO_MODE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(MANAGED_DEMO_MODE_CHANGE_EVENT));
};

export const useManagedDemoModeEnabled = () =>
  useSyncExternalStore(subscribeToManagedDemoMode, readManagedDemoModeEnabled, () => false);
