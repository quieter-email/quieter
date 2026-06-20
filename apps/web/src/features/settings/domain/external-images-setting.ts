"use client";

import { useSyncExternalStore } from "react";

const EXTERNAL_IMAGES_STORAGE_KEY = "quieter:external-images-enabled";
const EXTERNAL_IMAGES_CHANGE_EVENT = "quieter:external-images-enabled-change";

const DEFAULT_EXTERNAL_IMAGES_ENABLED = false;

const readExternalImagesEnabled = () => {
  if (typeof window === "undefined") return DEFAULT_EXTERNAL_IMAGES_ENABLED;
  return window.localStorage.getItem(EXTERNAL_IMAGES_STORAGE_KEY) === "true";
};

const subscribeToExternalImagesEnabled = (callback: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === EXTERNAL_IMAGES_STORAGE_KEY) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(EXTERNAL_IMAGES_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(EXTERNAL_IMAGES_CHANGE_EVENT, callback);
  };
};

export const setExternalImagesEnabled = (enabled: boolean) => {
  window.localStorage.setItem(EXTERNAL_IMAGES_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(EXTERNAL_IMAGES_CHANGE_EVENT));
};

export const useExternalImagesEnabled = () =>
  useSyncExternalStore(
    subscribeToExternalImagesEnabled,
    readExternalImagesEnabled,
    () => DEFAULT_EXTERNAL_IMAGES_ENABLED,
  );
