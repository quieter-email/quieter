export const SETTINGS_TABS = ["general", "account", "plan", "organization", "mailboxes"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
