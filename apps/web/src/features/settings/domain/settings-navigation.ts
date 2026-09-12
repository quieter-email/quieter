import type { SettingsTab } from "./settings-tab";

export const SETTINGS_TITLES = {
  account: "Account",
  ai: "AI & personalization",
  appearance: "Preferences",
  connectors: "Connected apps",
  development: "Development",
  mailboxes: "Mailboxes",
  organization: "Team settings",
  overview: "Preferences",
  privacy: "Preferences",
  reading: "Preferences",
  shortcuts: "Preferences",
} as const satisfies Record<SettingsTab, string>;
