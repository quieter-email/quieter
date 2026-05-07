"use client";

import { useSyncExternalStore } from "react";

const DEMO_MODE_STORAGE_KEY = "quieter:demo-mode-enabled";
const DEMO_MODE_CHANGE_EVENT = "quieter:demo-mode-enabled-change";

export const isDemoModeAvailable = () => import.meta.env.DEV;

export const readDemoModeEnabled = () => {
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

export const setDemoModeEnabled = (enabled: boolean) => {
  if (!isDemoModeAvailable()) return;

  window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(DEMO_MODE_CHANGE_EVENT));
};

export const useDemoModeEnabled = () =>
  useSyncExternalStore(subscribeToDemoMode, readDemoModeEnabled, () => false);
