"use client";

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
import { useQuery } from "@tanstack/react-query";
import type { SettingsTab } from "~/features/settings/domain/settings-tab";
import { isDemoModeAvailable } from "~/features/settings/domain/demo-mode-setting";
import {
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_LABELS,
  type SettingsNavSection,
} from "~/features/settings/domain/settings-navigation";
import { authClient } from "~/lib/auth";
import { connectorsQueryOptions } from "~/lib/connectors-query";
import { mailboxesQueryOptions } from "~/lib/mailboxes-query";
import {
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
  SettingsSection,
} from "./settings-layout";

type SettingsUser = {
  email: string;
  name: string;
};

type SettingsOverviewPanelProps = {
  initialUser: SettingsUser;
  onSelectTab: (tab: SettingsTab) => void;
};

const SETTINGS_NAV_ICONS = {
  ai: AiBrain01Icon,
  appearance: Moon01Icon,
  reading: Image01Icon,
  shortcuts: KeyboardIcon,
  privacy: SecurityLockIcon,
  development: CodeIcon,
  mailboxes: Mail01Icon,
  actions: Settings01Icon,
  organization: UserGroupIcon,
  connectors: ConnectIcon,
  account: UserIcon,
} as const;

const SETTINGS_SECTIONS: SettingsNavSection[] = ["preferences", "workspace", "personal"];

export const SettingsOverviewPanel = ({ initialUser, onSelectTab }: SettingsOverviewPanelProps) => {
  const organizations = authClient.useListOrganizations().data ?? [];
  const { data: connectorsData } = useQuery(connectorsQueryOptions());
  const { data: mailboxesData } = useQuery(mailboxesQueryOptions());
  const mailboxCount =
    mailboxesData?.groups.reduce((total, group) => total + group.mailboxes.length, 0) ?? 0;
  const connectedConnectorCount =
    connectorsData?.connectors.filter((connector) => connector.status === "connected").length ?? 0;
  const sessionUser = authClient.useSession().data?.user;
  const user = {
    email: sessionUser?.email ?? initialUser.email,
    name: sessionUser?.name ?? initialUser.name,
  };
  const showDevelopment = isDemoModeAvailable();
  const navItems = SETTINGS_NAV_ITEMS.filter(
    (item) => !("developmentOnly" in item && item.developmentOnly) || showDevelopment,
  );

  const metaForTab = (tab: (typeof SETTINGS_NAV_ITEMS)[number]["tab"]) => {
    switch (tab) {
      case "mailboxes":
        return mailboxCount === 1 ? "1 Mailbox" : `${mailboxCount} Mailboxes`;
      case "organization":
        return organizations.length === 1 ? "1 Team" : `${organizations.length} Teams`;
      case "connectors":
        return connectedConnectorCount === 1
          ? "1 Connected"
          : `${connectedConnectorCount} Connected`;
      case "account":
        return user.name;
      default:
        return null;
    }
  };

  return (
    <div className="w-full space-y-8">
      <SettingsPageHeader title="Settings" />

      {SETTINGS_SECTIONS.map((section) => {
        const items = navItems.filter((item) => item.section === section);
        if (items.length === 0) return null;

        return (
          <SettingsSection key={section} title={SETTINGS_SECTION_LABELS[section]}>
            <SettingsRows>
              {items.map(({ tab, title, description }) => {
                const meta = metaForTab(tab);

                return (
                  <SettingsNavigationRow
                    description={description}
                    icon={<HugeiconsIcon aria-hidden icon={SETTINGS_NAV_ICONS[tab]} />}
                    key={tab}
                    meta={meta ? <span>{meta}</span> : undefined}
                    onClick={() => onSelectTab(tab)}
                    title={title}
                  />
                );
              })}
            </SettingsRows>
          </SettingsSection>
        );
      })}
    </div>
  );
};
