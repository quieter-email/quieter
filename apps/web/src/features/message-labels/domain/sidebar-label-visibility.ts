import type { MailboxLabel } from "@quieter/mail/mailbox-organization";

export const MAX_VISIBLE_SIDEBAR_LABELS = 10;

export const SIDEBAR_LABEL_VISIBILITY_EVENT =
  "quieter:sidebar-label-visibility-change";

export const computeEffectiveHiddenLabelIds = (
  mailboxProvider: "gmail" | "managed",
  userLabels: MailboxLabel[],
  hiddenLabelIds: Set<string>
) => {
  const effectiveHiddenLabelIds = new Set<string>();
  if (mailboxProvider === "managed") {
    for (const label of userLabels) {
      if (!label.visible) {
        effectiveHiddenLabelIds.add(label.id);
      }
    }
    return effectiveHiddenLabelIds;
  }

  for (const labelId of hiddenLabelIds) {
    effectiveHiddenLabelIds.add(labelId);
  }

  let visibleLabelCount = 0;
  for (const label of userLabels) {
    if (hiddenLabelIds.has(label.id)) {
      continue;
    }
    if (visibleLabelCount >= MAX_VISIBLE_SIDEBAR_LABELS) {
      effectiveHiddenLabelIds.add(label.id);
      continue;
    }
    visibleLabelCount += 1;
  }

  return effectiveHiddenLabelIds;
};

export const SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY =
  "quieter:sidebar-label-visibility";

export type HiddenLabelState = {
  mailboxId: string | null;
  value: Set<string>;
};

export type HiddenLabelAction = {
  mailboxId: string;
  updater: (current: Set<string>) => Set<string>;
};

const isNonemptyMailboxId = (
  mailboxId: string | null | undefined
): mailboxId is string => (mailboxId?.trim() ?? "") !== "";

const parseHiddenLabelStorage = (
  raw: string | null
): Record<string, string[]> => {
  if (raw === null) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    const entries: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        Array.isArray(value) &&
        value.every((item) => typeof item === "string")
      ) {
        entries[key] = value;
      }
    }
    return entries;
  } catch {
    return {};
  }
};

export const readHiddenLabelIds = (mailboxId: string | null) => {
  if (!isNonemptyMailboxId(mailboxId) || typeof window === "undefined") {
    return new Set<string>();
  }

  const parsed = parseHiddenLabelStorage(
    window.localStorage.getItem(SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY)
  );
  const storedIds = parsed[mailboxId];
  return storedIds === undefined ? new Set<string>() : new Set(storedIds);
};

const writeHiddenLabelIds = (
  mailboxId: string,
  hiddenLabelIds: Set<string>
) => {
  let parsed: Record<string, string[]> = {};
  try {
    const raw = window.localStorage.getItem(
      SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY
    );
    parsed = raw === null ? {} : parseHiddenLabelStorage(raw);
  } catch {
    // Ignore corrupted sidebar label visibility storage.
  }

  parsed[mailboxId] = [...hiddenLabelIds];
  window.localStorage.setItem(
    SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY,
    JSON.stringify(parsed)
  );
  window.dispatchEvent(new Event(SIDEBAR_LABEL_VISIBILITY_EVENT));
};

export const createHiddenLabelState = (
  mailboxId: string | null
): HiddenLabelState => ({
  mailboxId,
  value: readHiddenLabelIds(mailboxId),
});

export const reduceHiddenLabelState = (
  current: HiddenLabelState,
  { mailboxId, updater }: HiddenLabelAction
): HiddenLabelState => {
  const currentValue =
    current.mailboxId === mailboxId
      ? current.value
      : readHiddenLabelIds(mailboxId);
  const next = updater(new Set(currentValue));
  writeHiddenLabelIds(mailboxId, next);
  return {
    mailboxId,
    value: next,
  };
};
