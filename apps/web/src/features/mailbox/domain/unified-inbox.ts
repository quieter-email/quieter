import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";

import { buildThreadListEntries } from "#/lib/gmail/thread-list";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";
import type { MessageListItem } from "#/lib/mail";

export type UnifiedInboxMailbox = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  provider: "api" | "gmail" | "managed";
  connectionStatus: "connected" | "needs_reconnect";
  grantRole?: string | null;
  signatureHtml?: string | null;
  signatureText?: string | null;
};

export type UnifiedInboxPreferences = {
  excludedIds: string[];
  colors: Record<string, MailboxLabelColor>;
};

const DEFAULT_COLORS: MailboxLabelColor[] = [
  "blue",
  "cyan",
  "green",
  "orange",
  "pink",
  "purple",
  "yellow",
  "red",
  "gray",
];

export const defaultMailboxColor = (mailboxId: string): MailboxLabelColor => {
  let hash = 0;
  for (const character of mailboxId) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return DEFAULT_COLORS[hash % DEFAULT_COLORS.length] ?? "gray";
};

export const readUnifiedInboxPreferences = (
  userId: string
): UnifiedInboxPreferences => {
  const empty = {
    colors: {},
    excludedIds: [],
  } satisfies UnifiedInboxPreferences;
  if (typeof window === "undefined" || !userId) {
    return empty;
  }
  try {
    const raw = window.localStorage.getItem(
      `quieter:unified-inbox:v1:${userId}`
    );
    if (!raw) {
      return empty;
    }
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return empty;
    }
    if (!("version" in value) || value.version !== 1) {
      return empty;
    }
    const excludedIds =
      "excludedIds" in value && Array.isArray(value.excludedIds)
        ? value.excludedIds.filter((id): id is string => typeof id === "string")
        : [];
    const colors: Record<string, MailboxLabelColor> = {};
    if (
      "colors" in value &&
      value.colors !== null &&
      typeof value.colors === "object" &&
      !Array.isArray(value.colors)
    ) {
      for (const [id, color] of Object.entries(value.colors)) {
        const matchedColor = DEFAULT_COLORS.find(
          (candidate) => candidate === color
        );
        if (matchedColor !== undefined) {
          colors[id] = matchedColor;
        }
      }
    }
    return { colors, excludedIds };
  } catch {
    return empty;
  }
};

export const writeUnifiedInboxPreferences = (
  userId: string,
  preferences: UnifiedInboxPreferences,
  accessibleIds: readonly string[]
): void => {
  if (typeof window === "undefined" || !userId) {
    return;
  }
  const available = new Set(accessibleIds);
  const colors = Object.fromEntries(
    Object.entries(preferences.colors).filter(([id]) => available.has(id))
  );
  try {
    window.localStorage.setItem(
      `quieter:unified-inbox:v1:${userId}`,
      JSON.stringify({
        colors,
        excludedIds: preferences.excludedIds.filter((id) => available.has(id)),
        version: 1,
      })
    );
  } catch {
    // The panel remains usable when storage is unavailable.
  }
};

export type UnifiedInboxEntry = {
  mailboxId: string;
  thread: ThreadListEntry;
  timestamp: number;
};

const messageTimestamp = (message: MessageListItem): number => {
  const source = message.internalDate ?? message.date;
  if (!source) {
    return 0;
  }
  const numeric = Number(source);
  const time = Number.isFinite(numeric) ? numeric : Date.parse(source);
  return Number.isFinite(time) ? time : 0;
};

export const buildUnifiedInboxEntries = (
  sources: readonly {
    mailboxId: string;
    messages: readonly MessageListItem[];
    hasNextPage: boolean;
  }[]
): UnifiedInboxEntry[] => {
  const openSources = sources.filter((source) => source.hasNextPage);
  let safeOldestTimestamp = 0;
  for (const source of openSources) {
    let oldest = Number.POSITIVE_INFINITY;
    for (const message of source.messages) {
      oldest = Math.min(oldest, messageTimestamp(message));
    }
    if (oldest !== Number.POSITIVE_INFINITY) {
      safeOldestTimestamp = Math.max(safeOldestTimestamp, oldest);
    }
  }
  return sources
    .flatMap((source) =>
      buildThreadListEntries(source.messages).map((thread) => ({
        mailboxId: source.mailboxId,
        thread,
        timestamp: Math.max(...thread.messages.map(messageTimestamp)),
      }))
    )
    .filter((entry) => entry.timestamp >= safeOldestTimestamp)
    .toSorted(
      (left, right) =>
        right.timestamp - left.timestamp ||
        left.mailboxId.localeCompare(right.mailboxId) ||
        left.thread.threadId.localeCompare(right.thread.threadId)
    );
};
