"use client";

import type { mailboxSearchSchema } from "@quieter/app/route-search";
import { useSyncExternalStore } from "react";
import type { z } from "zod";

export const DEFAULT_VIEW_OPTIONS = [
  { label: "Inbox", value: "inbox" },
  { label: "Important", value: "important" },
  { label: "Unread", value: "unread" },
  { label: "Sent", value: "sent" },
  { label: "Drafts", value: "drafts" },
  { label: "Archive", value: "archive" },
  { label: "Spam", value: "spam" },
  { label: "Trash", value: "trash" },
  { label: "Calendar", value: "calendar" },
  { label: "Compose", value: "compose" },
] as const;

export type DefaultView = (typeof DEFAULT_VIEW_OPTIONS)[number]["value"];

const volatileChoices = new Map<string, DefaultView>();
const CHANGE_EVENT = "quieter:default-view-change";

export const readDefaultView = (userId: string): DefaultView => {
  if (typeof window === "undefined" || !userId) {
    return "inbox";
  }
  const volatileChoice = volatileChoices.get(userId);
  if (volatileChoice !== undefined) {
    return volatileChoice;
  }
  try {
    const stored = window.localStorage.getItem(
      `quieter:default-view:${userId}`
    );
    return (
      DEFAULT_VIEW_OPTIONS.find((option) => option.value === stored)?.value ??
      "inbox"
    );
  } catch {
    return "inbox";
  }
};

const subscribeToDefaultView = (onStoreChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null) {
      volatileChoices.clear();
    } else if (event.key.startsWith("quieter:default-view:")) {
      volatileChoices.delete(event.key.slice("quieter:default-view:".length));
    } else {
      return;
    }
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
};

export const setDefaultView = (userId: string, view: DefaultView) => {
  if (typeof window === "undefined" || !userId) {
    return;
  }
  try {
    window.localStorage.setItem(`quieter:default-view:${userId}`, view);
    volatileChoices.delete(userId);
  } catch {
    volatileChoices.set(userId, view);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const useDefaultView = (userId: string) =>
  useSyncExternalStore(
    subscribeToDefaultView,
    () => readDefaultView(userId),
    () => "inbox" as const
  );

export const resolveDefaultViewSearch = ({
  search,
  view,
}: {
  search: string;
  view: DefaultView;
}): Pick<
  z.infer<typeof mailboxSearchSchema>,
  "mailbox" | "workspace"
> | null => {
  const parameters = new URLSearchParams(search);
  if (
    [...parameters].some(
      ([key, value]) => key !== "mailbox" || value !== "inbox"
    )
  ) {
    return null;
  }
  return view === "calendar"
    ? { mailbox: "inbox", workspace: "calendar" }
    : { mailbox: view };
};
