"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";

export {
  normalizeSearchText,
  parseStructuredSearchFilterToken,
  parseStructuredSearchQuery,
  serializeStructuredSearchFilterToken,
  type MailSearchFilter as SearchFilterChip,
  type StructuredMailSearch as StructuredSearchState,
} from "@quieter/mail/search";

export const normalizeLabelSelectionKey = (value: string) => value.trim().toLocaleLowerCase();

export const getUserLabels = <TLabel extends MailboxLabel>(labels: readonly TLabel[]) =>
  labels.filter((label) => label.type === "user");
