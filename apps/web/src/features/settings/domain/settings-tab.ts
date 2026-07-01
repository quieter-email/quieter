export const SETTINGS_TABS = [
  "overview",
  "appearance",
  "reading",
  "shortcuts",
  "privacy",
  "development",
  "account",
  "organization",
  "mailboxes",
  "connectors",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
