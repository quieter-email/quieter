import type { SettingsDestination } from "./settings-destination";

export type SettingsSearchEntry = SettingsDestination & {
  id: string;
  title: string;
  description: string;
  keywords: string;
  scope: "personal" | "team" | "mailbox";
  developmentOnly?: boolean;
};

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    description: "Profile and account security",
    id: "account",
    keywords: "name email password passkey sign out delete account",
    scope: "personal",
    tab: "account",
    title: "Account",
  },
  {
    description: "Preferences / Color mode",
    id: "theme",
    keywords: "dark mode light theme colors",
    scope: "personal",
    section: "color-mode",
    tab: "appearance",
    title: "Appearance",
  },
  {
    description: "Preferences / Allow external images",
    id: "reading",
    keywords: "remote external images messages",
    scope: "personal",
    section: "allow-external-images",
    tab: "reading",
    title: "Reading",
  },
  {
    description: "Preferences / Keyboard shortcuts",
    id: "shortcuts",
    keywords: "hotkeys keyboard bindings",
    scope: "personal",
    section: "keyboard-shortcuts",
    tab: "shortcuts",
    title: "Keyboard shortcuts",
  },
  {
    description: "Preferences / Privacy",
    id: "privacy",
    keywords: "privacy consent tracking cookies analytics",
    scope: "personal",
    section: "cookie-and-analytics-preferences",
    tab: "privacy",
    title: "Cookie and analytics preferences",
  },
  {
    description: "AI & personalization / Models",
    id: "models",
    keywords: "assistant model auto label useful details search filters",
    scope: "personal",
    section: "models",
    tab: "ai",
    title: "AI models",
  },
  {
    description: "AI & personalization / Personalization",
    id: "memory",
    keywords: "forget memory knowledge reset personalization",
    scope: "personal",
    section: "reset-personalization",
    tab: "ai",
    title: "Reset personalization",
  },
  {
    description: "Connected services for chat",
    id: "connectors",
    keywords: "integrations connectors linear oauth services",
    scope: "personal",
    tab: "connectors",
    title: "Connected apps",
  },
  {
    description: "Local demo mailboxes",
    developmentOnly: true,
    id: "development",
    keywords: "demo mode local debug sandbox",
    scope: "personal",
    tab: "development",
    title: "Development",
  },
  {
    description: "General / Team name and address",
    id: "general",
    keywords: "team name slug leave delete",
    organizationView: "overview",
    scope: "team",
    tab: "organization",
    title: "Team details",
  },
  {
    description: "Members & access / Members & invitations",
    id: "members",
    keywords: "invite teammate people invitation role",
    organizationView: "members",
    scope: "team",
    tab: "organization",
    title: "Members and invitations",
  },
  {
    description: "Members & access / Access groups",
    id: "groups",
    keywords: "division groups permissions",
    organizationView: "divisions",
    scope: "team",
    tab: "organization",
    title: "Access groups",
  },
  {
    description: "Domains / Mail routing and setup",
    id: "domains",
    keywords: "dns domain routing verification",
    organizationView: "domains",
    scope: "team",
    tab: "organization",
    title: "Domains",
  },
  {
    description: "Delivery / Tracking & metrics",
    id: "delivery",
    keywords: "tracking metrics delivery",
    organizationView: "delivery",
    scope: "team",
    tab: "organization",
    title: "Delivery",
  },
  {
    description: "Delivery / Blocked recipients",
    id: "blocked",
    keywords: "bounces complaints spam suppressions",
    organizationView: "suppressions",
    scope: "team",
    tab: "organization",
    title: "Blocked recipients",
  },
  {
    description: "Billing & usage / Plan & credits",
    id: "billing",
    keywords: "billing plan invoice receipt seats credits subscription payment",
    organizationView: "billing",
    scope: "team",
    tab: "organization",
    title: "Billing & usage",
  },
  {
    description: "Billing & usage / Mail usage",
    id: "usage",
    keywords: "sending usage limits overage",
    organizationView: "billing",
    scope: "team",
    section: "usage",
    tab: "organization",
    title: "Mail usage",
  },
  {
    description: "API keys",
    id: "keys",
    keywords: "api keys tokens",
    organizationView: "api-keys",
    scope: "team",
    tab: "organization",
    title: "API keys",
  },
  {
    description: "Mailboxes / Connections and access",
    id: "mailboxes",
    keywords: "gmail mailbox inbox add connect",
    scope: "team",
    tab: "mailboxes",
    title: "Mailboxes",
  },
  {
    description: "Mailboxes / Signature",
    id: "signature",
    keywords: "signature footer signoff",
    scope: "mailbox",
    section: "signature",
    tab: "mailboxes",
    title: "Signature",
  },
  {
    description: "Mailboxes / Intelligence",
    id: "intelligence",
    keywords: "automatic labels auto labeling useful details automation",
    scope: "mailbox",
    section: "intelligence",
    tab: "mailboxes",
    title: "Mailbox intelligence",
  },
];

const editDistance = (left: string, right: string) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) +
          (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length] ?? left.length;
};

export const matchSettingsEntries = (
  query: string,
  {
    includeDevelopment,
    entries = SETTINGS_SEARCH_ENTRIES,
  }: { includeDevelopment: boolean; entries?: readonly SettingsSearchEntry[] }
) => {
  const normalized = query.trim().toLowerCase().slice(0, 160);
  if (!normalized) {
    return [];
  }
  const tokens = normalized.split(/\s+/u);
  return entries
    .flatMap((entry) => {
      if (!includeDevelopment && entry.developmentOnly === true) {
        return [];
      }
      const title = entry.title.toLowerCase();
      if (title === normalized) {
        return [{ entry, score: -2 }];
      }
      if (title.startsWith(normalized)) {
        return [{ entry, score: -1 }];
      }
      const words = `${title} ${entry.keywords} ${entry.description}`
        .toLowerCase()
        .split(/\s+/u);
      let score = 0;
      for (const token of tokens) {
        const distance = Math.min(
          ...words.map((word) =>
            word.includes(token) ? 0 : editDistance(token, word)
          )
        );
        if (distance > Math.min(2, Math.floor(token.length / 3))) {
          return [];
        }
        score += distance;
      }
      return [{ entry, score }];
    })
    .toSorted(
      (left, right) =>
        left.score - right.score ||
        left.entry.title.localeCompare(right.entry.title)
    )
    .map(({ entry }) => entry);
};
