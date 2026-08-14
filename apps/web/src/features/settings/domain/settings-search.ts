import {
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_LABELS,
} from "./settings-navigation";
import type {
  SettingsDetailTab,
  SettingsNavSection,
} from "./settings-navigation";

export type SettingsSearchEntry = {
  description: string;
  developmentOnly: boolean;
  keywords: readonly string[];
  section: SettingsNavSection;
  sectionLabel: string;
  tab: SettingsDetailTab;
  title: string;
};

/**
 * What people actually type when they are looking for a setting, as opposed to
 * what the destination is called. Titles and descriptions are matched already,
 * so these only need to cover the gap.
 */
const SETTINGS_SEARCH_KEYWORDS: Record<SettingsDetailTab, readonly string[]> = {
  account: [
    "profile",
    "name",
    "email",
    "password",
    "passkey",
    "sign out",
    "delete account",
  ],
  actions: [
    "automation",
    "workflow",
    "rules",
    "triggers",
    "linear",
    "integrations",
  ],
  ai: [
    "model",
    "memory",
    "knowledge",
    "auto-label",
    "useful details",
    "assistant",
  ],
  appearance: ["theme", "dark mode", "light mode", "colors", "font", "density"],
  connectors: ["integrations", "linear", "connect", "oauth", "services"],
  development: ["demo mode", "local", "debug", "sandbox"],
  mailboxes: [
    "gmail",
    "accounts",
    "signature",
    "shared inbox",
    "domains",
    "add mailbox",
  ],
  organization: [
    "team",
    "members",
    "billing",
    "plan",
    "invoice",
    "usage",
    "seats",
    "api keys",
    "blocked recipients",
    "bounces",
    "spam complaints",
  ],
  privacy: ["cookies", "consent", "tracking", "analytics", "data"],
  reading: ["messages", "external images", "preview", "list", "inbox"],
  shortcuts: ["keyboard", "hotkeys", "keys", "bindings"],
};

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] =
  SETTINGS_NAV_ITEMS.map((item) => ({
    description: item.description,
    developmentOnly: "developmentOnly" in item && item.developmentOnly,
    keywords: SETTINGS_SEARCH_KEYWORDS[item.tab],
    section: item.section,
    sectionLabel: SETTINGS_SECTION_LABELS[item.section],
    tab: item.tab,
    title: item.title,
  }));

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Ranks title matches above keyword matches above description matches, so
 * typing a destination's name always puts it first.
 */
const scoreEntry = (entry: SettingsSearchEntry, query: string) => {
  const title = normalize(entry.title);
  if (title === query) {
    return 0;
  }
  if (title.startsWith(query)) {
    return 1;
  }
  if (title.includes(query)) {
    return 2;
  }
  if (entry.keywords.some((keyword) => normalize(keyword).includes(query))) {
    return 3;
  }
  if (normalize(entry.description).includes(query)) {
    return 4;
  }
  if (normalize(entry.sectionLabel).includes(query)) {
    return 5;
  }
  return null;
};

export const matchSettingsEntries = (
  query: string,
  { includeDevelopment }: { includeDevelopment: boolean }
) => {
  const normalized = normalize(query);
  const available = SETTINGS_SEARCH_ENTRIES.filter(
    (entry) => includeDevelopment || !entry.developmentOnly
  );

  if (normalized === "") {
    return [];
  }

  return available
    .flatMap((entry) => {
      const score = scoreEntry(entry, normalized);
      return score === null ? [] : [{ entry, score }];
    })
    .toSorted(
      (a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title)
    )
    .map(({ entry }) => entry);
};
