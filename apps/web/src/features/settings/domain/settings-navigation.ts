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
    description: "Choose how Quieter looks.",
    section: "preferences",
    tab: "appearance",
    title: "Appearance",
  },
  {
    description: "Choose models and review what Quieter remembers.",
    section: "preferences",
    tab: "ai",
    title: "AI",
  },
  {
    description: "Choose how messages are displayed.",
    section: "preferences",
    tab: "reading",
    title: "Reading",
  },
  {
    description: "See the shortcuts available in Quieter.",
    section: "preferences",
    tab: "shortcuts",
    title: "Keyboard shortcuts",
  },
  {
    description: "Manage your privacy preferences.",
    section: "preferences",
    tab: "privacy",
    title: "Privacy",
  },
  {
    description: "Settings for local development.",
    developmentOnly: true,
    section: "preferences",
    tab: "development",
    title: "Development",
  },
  {
    description: "Manage the mailboxes connected to Quieter.",
    section: "workspace",
    tab: "mailboxes",
    title: "Mailboxes",
  },
  {
    description: "Build mailbox workflows that react to incoming mail.",
    section: "workspace",
    tab: "actions",
    title: "Actions",
  },
  {
    description: "Manage your teams and organization settings.",
    section: "workspace",
    tab: "organization",
    title: "Teams",
  },
  {
    description: "Connect outside services for mail actions and chat.",
    section: "workspace",
    tab: "connectors",
    title: "Connectors",
  },
  {
    description: "Manage your Quieter account.",
    section: "personal",
    tab: "account",
    title: "Account",
  },
] as const satisfies readonly SettingsNavItem[];

export const SETTINGS_SECTION_LABELS = {
  personal: "Personal",
  preferences: "Preferences",
  workspace: "Workspace",
} as const satisfies Record<SettingsNavSection, string>;

export const SETTINGS_DETAIL_TITLES = Object.fromEntries(
  SETTINGS_NAV_ITEMS.map(({ tab, title }) => [tab, { title }])
);
