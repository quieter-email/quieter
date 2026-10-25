import type { SettingsTab } from "@quieter/app/features/settings/domain/settings-tab";

export const SETTINGS_TITLES = {
  account: "Account",
  ai: "Memories",
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
