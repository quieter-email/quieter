"use client";

import { useSyncExternalStore } from "react";
import { isPreviewPersonasAvailable } from "~/lib/preview-personas";

const DEMO_MODE_STORAGE_KEY = "quieter:demo-mode-enabled";
const DEMO_MODE_CHANGE_EVENT = "quieter:demo-mode-enabled-change";
const MANAGED_DEMO_MODE_STORAGE_KEY = "quieter:managed-demo-mode-enabled";
const MANAGED_DEMO_MODE_CHANGE_EVENT = "quieter:managed-demo-mode-enabled-change";

export const isDemoModeAvailable = () => isPreviewPersonasAvailable();

const readDemoModeEnabled = () => {
  if (!isDemoModeAvailable() || typeof window === "undefined") return false;
  return window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "true";
};

const subscribeToDemoMode = (callback: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEMO_MODE_STORAGE_KEY) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(DEMO_MODE_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(DEMO_MODE_CHANGE_EVENT, callback);
  };
};

const disableManagedDemoMode = () => {
  window.localStorage.setItem(MANAGED_DEMO_MODE_STORAGE_KEY, "false");
  window.dispatchEvent(new Event(MANAGED_DEMO_MODE_CHANGE_EVENT));
};

export const setDemoModeEnabled = (enabled: boolean) => {
  if (!isDemoModeAvailable()) return;

  if (enabled) {
    disableManagedDemoMode();
  }

  window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(DEMO_MODE_CHANGE_EVENT));
};

export const useDemoModeEnabled = () =>
  useSyncExternalStore(subscribeToDemoMode, readDemoModeEnabled, () => false);
