import { z } from "zod";
import type { MailboxCategory } from "./gmail/gmail";

const mailboxCategories = ["inbox", "spam", "sent", "trash", "drafts"] as const;
const settingsTabs = ["general", "account", "organization", "mailboxes"] as const;
const mailboxCategorySet = new Set<string>(mailboxCategories);
const settingsTabSet = new Set<string>(settingsTabs);

export type SettingsTab = (typeof settingsTabs)[number];

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue ? normalizedValue : null;
};

const normalizeMailboxCategory = (value: string | null | undefined): MailboxCategory => {
  return value && mailboxCategorySet.has(value) ? (value as MailboxCategory) : "inbox";
};

const normalizeRelativePath = (value: string | null | undefined) => {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !normalizedValue.startsWith("/") || normalizedValue.startsWith("//")) {
    return "/";
  }

  return normalizedValue;
};

export const mailboxSearchDefaults = {
  mailbox: "inbox",
  query: "",
} as const;

export const settingsSearchDefaults = {
  from: "/",
  tab: "general",
} as const;

const searchInputStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);

export const mailboxSearchSchema = z
  .object({
    mailbox: searchInputStringSchema,
    mailboxId: searchInputStringSchema,
    messageId: searchInputStringSchema,
    query: searchInputStringSchema,
  })
  .transform((search) => ({
    mailbox: normalizeMailboxCategory(search.mailbox ?? null),
    mailboxId: normalizeOptionalString(search.mailboxId),
    messageId: normalizeOptionalString(search.messageId),
    query: normalizeOptionalString(search.query) ?? "",
  }));

export const settingsSearchSchema = z
  .object({
    from: searchInputStringSchema,
    tab: searchInputStringSchema,
  })
  .transform((search) => {
    const normalizedTab = normalizeOptionalString(search.tab);

    return {
      from: normalizeRelativePath(search.from ?? settingsSearchDefaults.from),
      tab:
        normalizedTab && settingsTabSet.has(normalizedTab)
          ? (normalizedTab as SettingsTab)
          : settingsSearchDefaults.tab,
    };
  });

export const authSearchSchema = z
  .object({
    error: searchInputStringSchema,
  })
  .transform((search) => ({
    error: normalizeOptionalString(search.error),
  }));

export type MailboxSearch = z.output<typeof mailboxSearchSchema>;
export type MailboxSearchInput = {
  mailbox: MailboxCategory;
  mailboxId: string | undefined;
  messageId: string | undefined;
  query: string;
};
type MailboxSearchUpdate = {
  mailbox?: MailboxCategory;
  mailboxId?: string | null;
  messageId?: string | null;
  query?: string | null;
};

export type SettingsSearch = z.output<typeof settingsSearchSchema>;
export type SettingsSearchInput = {
  from: string;
  tab: SettingsTab;
};

export type AuthSearch = z.output<typeof authSearchSchema>;
export type AuthSearchInput = {
  error: string | undefined;
};

export const toMailboxSearch = (search: MailboxSearchUpdate): MailboxSearchInput => ({
  mailbox: normalizeMailboxCategory(
    typeof search.mailbox === "string" ? search.mailbox : mailboxSearchDefaults.mailbox,
  ),
  mailboxId: normalizeOptionalString(search.mailboxId) ?? undefined,
  messageId: normalizeOptionalString(search.messageId) ?? undefined,
  query: normalizeOptionalString(search.query) ?? mailboxSearchDefaults.query,
});

export const toSettingsSearch = (search: Partial<SettingsSearch>): SettingsSearchInput => {
  const tab =
    typeof search.tab === "string" && settingsTabSet.has(search.tab)
      ? (search.tab as SettingsTab)
      : settingsSearchDefaults.tab;

  return {
    from: normalizeRelativePath(search.from),
    tab,
  };
};

export const toAuthSearch = (search?: { error?: string | null }): AuthSearchInput => ({
  error: normalizeOptionalString(search?.error) ?? undefined,
});

export const serializeMailboxSearchParams = (pathname: string, search: Partial<MailboxSearch>) => {
  const normalizedSearch = toMailboxSearch(search);
  const params = new URLSearchParams();

  if (normalizedSearch.mailboxId != null) {
    params.set("mailboxId", normalizedSearch.mailboxId);
  }

  if (normalizedSearch.mailbox !== mailboxSearchDefaults.mailbox) {
    params.set("mailbox", normalizedSearch.mailbox);
  }

  if (normalizedSearch.messageId != null) {
    params.set("messageId", normalizedSearch.messageId);
  }

  if (normalizedSearch.query !== mailboxSearchDefaults.query) {
    params.set("query", normalizedSearch.query);
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
};

export const serializeSettingsSearchParams = (
  pathname: string,
  search: Partial<SettingsSearch>,
) => {
  const normalizedSearch = toSettingsSearch(search);
  const params = new URLSearchParams();

  if (normalizedSearch.from !== settingsSearchDefaults.from) {
    params.set("from", normalizedSearch.from);
  }

  if (normalizedSearch.tab !== settingsSearchDefaults.tab) {
    params.set("tab", normalizedSearch.tab);
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
};
