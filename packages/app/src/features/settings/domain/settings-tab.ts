export const SETTINGS_TABS = [
  "overview",
  "appearance",
  "ai",
  "reading",
  "shortcuts",
  "privacy",
  "development",
  "account",
  "billing",
  "organization",
  "mailboxes",
  "connectors",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
