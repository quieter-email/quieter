export const SETTINGS_TABS = [
  "overview",
  "appearance",
  "ai",
  "reading",
  "shortcuts",
  "privacy",
  "development",
  "account",
  "organization",
  "mailboxes",
  "actions",
  "connectors",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
