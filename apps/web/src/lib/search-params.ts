import { createLoader, createSerializer, parseAsString, parseAsStringLiteral } from "nuqs/server";

const mailboxCategories = ["inbox", "sent", "trash"] as const;
const settingsTabs = ["general", "account"] as const;

export type SettingsTab = (typeof settingsTabs)[number];

export const mailboxSearchParams = {
  mailbox: parseAsStringLiteral(mailboxCategories).withDefault("inbox"),
  messageId: parseAsString,
};

export const settingsSearchParams = {
  from: parseAsString.withDefault("/"),
  tab: parseAsStringLiteral(settingsTabs).withDefault("general"),
};

export const loadSettingsSearchParams = createLoader(settingsSearchParams);
export const serializeMailboxSearchParams = createSerializer(mailboxSearchParams);
export const serializeSettingsSearchParams = createSerializer(settingsSearchParams);
