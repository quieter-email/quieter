"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";

export type SidebarEntry = { id: string; label: string };
export type SidebarSection = SidebarEntry & {
  orderKey?: string;
  items?: readonly SidebarEntry[];
};

export const SIDEBAR_SECTIONS = "sections";
export const SIDEBAR_MAIL = "mail";
export const SIDEBAR_TOOLS = "tools";

const sidebarPreferencesSchema = z.object({
  countEntries: z.array(z.string()),
  order: z.record(z.string(), z.array(z.string())),
});

export type SidebarPreferences = z.infer<typeof sidebarPreferencesSchema>;

const defaults: SidebarPreferences = { countEntries: [], order: {} };
const changeEvent = "quieter:sidebar-preferences-change";
const snapshots = new Map<
  string,
  { raw: string; value: SidebarPreferences; volatile?: boolean }
>();

const readSidebarPreferences = (key: string) => {
  const cached = snapshots.get(key);
  if (cached?.volatile === true) {
    return cached.value;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      snapshots.delete(key);
      return defaults;
    }
    if (raw === cached?.raw) {
      return cached.value;
    }
    const result = sidebarPreferencesSchema.safeParse(JSON.parse(raw));
    const value = result.success ? result.data : defaults;
    snapshots.set(key, { raw, value });
    return value;
  } catch {
    return defaults;
  }
};

const subscribe = (notify: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null) {
      snapshots.clear();
    } else {
      snapshots.delete(event.key);
    }
    notify();
  };
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, notify);
    window.removeEventListener("storage", handleStorage);
  };
};

export const useSidebarPreferences = (userId: string) => {
  const key = `quieter:sidebar:${userId}`;
  const preferences = useSyncExternalStore(
    subscribe,
    () => (userId === "" ? defaults : readSidebarPreferences(key)),
    () => defaults
  );

  const updatePreferences = (
    update: (current: SidebarPreferences) => SidebarPreferences
  ) => {
    if (userId === "") {
      return;
    }
    const current = readSidebarPreferences(key);
    const value = update(current);
    if (value === current) {
      return;
    }
    const raw = JSON.stringify(value);
    try {
      window.localStorage.setItem(key, raw);
      snapshots.set(key, { raw, value });
    } catch {
      snapshots.set(key, { raw, value, volatile: true });
    }
    window.dispatchEvent(new Event(changeEvent));
  };

  return { preferences, updatePreferences };
};

export const orderSidebarEntries = <T extends { id: string }>(
  entries: readonly T[],
  order: readonly string[] = []
) => {
  const remaining = new Map(entries.map((entry) => [entry.id, entry]));
  const sorted: T[] = [];
  for (const id of order) {
    const entry = remaining.get(id);
    if (entry !== undefined) {
      sorted.push(entry);
      remaining.delete(id);
    }
  }
  return [...sorted, ...remaining.values()];
};

export const moveSidebarEntry = (
  entries: readonly SidebarEntry[],
  previousOrder: readonly string[] | undefined,
  id: string,
  offset: -1 | 1
): string[] | undefined => {
  const ordered = orderSidebarEntries(entries, previousOrder);
  const from = ordered.findIndex((entry) => entry.id === id);
  const to = from + offset;
  const entry = ordered[from];
  if (entry === undefined || to < 0 || to >= ordered.length) {
    return undefined;
  }
  ordered.splice(from, 1);
  ordered.splice(to, 0, entry);
  const visible = new Set(ordered.map((item) => item.id));
  const slots = new Set([
    ...(previousOrder ?? []),
    ...entries.map((item) => item.id),
  ]);
  const next = ordered.map((item) => item.id).values();
  return [...slots].map((slot) =>
    visible.has(slot) ? (next.next().value ?? slot) : slot
  );
};
