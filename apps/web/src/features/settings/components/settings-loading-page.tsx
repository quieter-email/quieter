import {
  AiBrain01Icon,
  CodeIcon,
  ConnectIcon,
  Image01Icon,
  KeyboardIcon,
  Mail01Icon,
  Moon01Icon,
  SecurityLockIcon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { LoadingSpinner } from "#/components/loading-spinner";
import {
  SETTINGS_DETAIL_TITLES,
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_LABELS,
} from "#/features/settings/domain/settings-navigation";
import type { SettingsNavSection } from "#/features/settings/domain/settings-navigation";
import type { SettingsTab } from "#/features/settings/domain/settings-tab";

const SETTINGS_NAV_ICONS = {
  account: UserIcon,
  actions: Settings01Icon,
  ai: AiBrain01Icon,
  appearance: Moon01Icon,
  connectors: ConnectIcon,
  development: CodeIcon,
  mailboxes: Mail01Icon,
  organization: UserGroupIcon,
  privacy: SecurityLockIcon,
  reading: Image01Icon,
  shortcuts: KeyboardIcon,
} as const;

const SETTINGS_SECTIONS: SettingsNavSection[] = [
  "preferences",
  "workspace",
  "personal",
];
const SETTINGS_DYNAMIC_META = new Set<SettingsTab>([
  "account",
  "connectors",
  "mailboxes",
  "organization",
]);

const SettingsPendingOverview = () => {
  const navItems = SETTINGS_NAV_ITEMS.filter(
    (item) =>
      !("developmentOnly" in item && item.developmentOnly) ||
      import.meta.env.DEV
  );

  return (
    <div className="w-full space-y-8">
      <header>
        <h1 className="text-title-sm font-normal tracking-tight text-fg">
          Settings
        </h1>
      </header>

      {SETTINGS_SECTIONS.map((section) => (
        <section className="space-y-4" key={section}>
          <h2 className="text-body font-normal text-fg">
            {SETTINGS_SECTION_LABELS[section]}
          </h2>
          <div className="squircle @container overflow-hidden rounded-lg border border-border bg-bg/58">
            {navItems.map(
              ({ description, section: itemSection, tab, title }) => {
                if (itemSection !== section) {
                  return null;
                }

                return (
                  <div
                    className="relative flex w-full items-center gap-4 px-4 py-3 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:px-6 @md:after:inset-x-6"
                    key={tab}
                  >
                    <div className="squircle flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-fg">
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4"
                        icon={SETTINGS_NAV_ICONS[tab]}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-normal text-fg">
                        {title}
                      </p>
                      <p className="mt-0.5 truncate text-caption/4 text-muted-fg">
                        {description}
                      </p>
                    </div>
                    {SETTINGS_DYNAMIC_META.has(tab) ? (
                      <output
                        aria-label={`Loading ${title.toLowerCase()}`}
                        aria-live="polite"
                        className="hidden w-12 justify-end @sm:inline-flex"
                      >
                        <span
                          aria-hidden
                          className="h-2 w-10 animate-pulse rounded-full bg-muted/65 motion-reduce:animate-none"
                        />
                      </output>
                    ) : null}
                    <span
                      aria-hidden
                      className="mr-1 size-2.5 shrink-0 rotate-45 border-t border-r border-muted-fg"
                    />
                  </div>
                );
              }
            )}
          </div>
        </section>
      ))}
    </div>
  );
};

export const SettingsLoadingPage = ({
  tab = "overview",
}: {
  tab?: SettingsTab;
}) => (
  <main className="min-h-dvh overflow-hidden text-fg">
    <div className="mx-auto w-full max-w-205 px-5 py-8 md:px-8 md:py-14">
      {tab === "overview" ? (
        <SettingsPendingOverview />
      ) : (
        <div className="space-y-8">
          <header>
            <h1 className="text-title-sm font-normal tracking-tight text-fg">
              {SETTINGS_DETAIL_TITLES[tab].title}
            </h1>
          </header>
          <output
            aria-label={`Loading ${tab} settings`}
            aria-live="polite"
            className="flex min-h-64 items-center justify-center"
          >
            <LoadingSpinner className="size-8 text-muted-fg" />
            <span className="sr-only">Loading {tab} settings</span>
          </output>
        </div>
      )}
    </div>
  </main>
);
