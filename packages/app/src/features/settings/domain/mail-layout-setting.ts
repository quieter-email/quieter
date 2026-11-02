"use client";

import { useSyncExternalStore } from "react";

export const MAIL_LAYOUT_OPTIONS = [
  { label: "Two panels", value: "two-panels" },
  { label: "One panel", value: "one-panel" },
] as const;

export type MailLayout = (typeof MAIL_LAYOUT_OPTIONS)[number]["value"];

const MAIL_LAYOUT_STORAGE_KEY = "quieter:mail-layout";
const MAIL_LAYOUT_CHANGE_EVENT = "quieter:mail-layout-change";
let snapshot: MailLayout | undefined;
let volatileChoice: MailLayout | undefined;

const readMailLayout = (): MailLayout => {
  if (typeof window === "undefined") {
    return "two-panels";
  }
  if (volatileChoice !== undefined) {
    return volatileChoice;
  }
  try {
    const stored = window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY);
    snapshot =
      MAIL_LAYOUT_OPTIONS.find((option) => option.value === stored)?.value ??
      "two-panels";
  } catch {
    return snapshot ?? "two-panels";
  }
  return snapshot;
};

const subscribeToMailLayout = (onStoreChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== MAIL_LAYOUT_STORAGE_KEY && event.key !== null) {
      return;
    }
    volatileChoice = undefined;
    snapshot =
      MAIL_LAYOUT_OPTIONS.find((option) => option.value === event.newValue)
        ?.value ?? "two-panels";
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(MAIL_LAYOUT_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(MAIL_LAYOUT_CHANGE_EVENT, onStoreChange);
  };
};

export const setMailLayout = (layout: MailLayout) => {
  snapshot = layout;
  try {
    window.localStorage.setItem(MAIL_LAYOUT_STORAGE_KEY, layout);
    volatileChoice = undefined;
  } catch {
    volatileChoice = layout;
  }
  window.dispatchEvent(new Event(MAIL_LAYOUT_CHANGE_EVENT));
};

export const useMailLayout = () =>
  useSyncExternalStore<MailLayout>(
    subscribeToMailLayout,
    readMailLayout,
    () => "two-panels"
  );
