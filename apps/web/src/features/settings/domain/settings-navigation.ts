import type { SettingsTab } from "./settings-tab";

export type SettingsNavSection = "preferences" | "workspace" | "personal";

export type SettingsDetailTab = Exclude<SettingsTab, "overview">;

export type SettingsNavItem = {
  tab: SettingsDetailTab;
  title: string;
  description: string;
  section: SettingsNavSection;
  developmentOnly?: boolean;
};

export const SETTINGS_NAV_ITEMS = [
  {
    tab: "appearance",
    title: "Appearance",
    description: "Choose how Quieter looks.",
    section: "preferences",
  },
  {
    tab: "reading",
    title: "Reading",
    description: "Choose how messages are displayed.",
    section: "preferences",
  },
  {
    tab: "shortcuts",
    title: "Keyboard shortcuts",
    description: "See the shortcuts available in Quieter.",
    section: "preferences",
  },
  {
    tab: "privacy",
    title: "Privacy",
    description: "Manage your privacy preferences.",
    section: "preferences",
  },
  {
    tab: "development",
    title: "Development",
    description: "Settings for local development.",
    section: "preferences",
    developmentOnly: true,
  },
  {
    tab: "mailboxes",
    title: "Mailboxes",
    description: "Manage the mailboxes connected to Quieter.",
    section: "workspace",
  },
  {
    tab: "organization",
    title: "Teams",
    description: "Manage your teams and organization settings.",
    section: "workspace",
  },
  {
    tab: "connectors",
    title: "Connectors",
    description: "Connect outside services for mail actions and chat.",
    section: "workspace",
  },
  {
    tab: "account",
    title: "Account",
    description: "Manage your Quieter account.",
    section: "personal",
  },
] as const satisfies ReadonlyArray<SettingsNavItem>;

export const SETTINGS_SECTION_LABELS = {
  personal: "Personal",
  preferences: "Preferences",
  workspace: "Workspace",
} as const satisfies Record<SettingsNavSection, string>;

export const SETTINGS_DETAIL_TITLES = Object.fromEntries(
  SETTINGS_NAV_ITEMS.map(({ tab, title }) => [tab, { title }]),
) as Record<SettingsDetailTab, { title: string }>;
