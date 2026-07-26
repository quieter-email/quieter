"use client";

import type { ReactNode } from "react";
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
  SettingsInlineLoading,
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
  onPrefetchTab: (tab: SettingsTab) => void;
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

export const SettingsOverviewPanel = ({
  initialUser,
  onPrefetchTab,
  onSelectTab,
}: SettingsOverviewPanelProps) => {
  const organizationsState = authClient.useListOrganizations();
  const organizations = organizationsState.data ?? [];
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
  const meta: Partial<Record<SettingsTab, ReactNode>> = {
    account: user.name || <SettingsInlineLoading label="Loading account" />,
    connectors: connectorsData ? (
      connectedConnectorCount === 1 ? (
        "1 Connected"
      ) : (
        `${connectedConnectorCount} Connected`
      )
    ) : (
      <SettingsInlineLoading label="Loading connectors" />
    ),
    mailboxes: mailboxesData ? (
      mailboxCount === 1 ? (
        "1 Mailbox"
      ) : (
        `${mailboxCount} Mailboxes`
      )
    ) : (
      <SettingsInlineLoading label="Loading mailboxes" />
    ),
    organization: organizationsState.isPending ? (
      <SettingsInlineLoading label="Loading teams" />
    ) : organizations.length === 1 ? (
      "1 Team"
    ) : (
      `${organizations.length} Teams`
    ),
  };

  return (
    <SettingsOverviewContent meta={meta} onPrefetchTab={onPrefetchTab} onSelectTab={onSelectTab} />
  );
};

export const SettingsOverviewContent = ({
  disabled = false,
  meta,
  onPrefetchTab,
  onSelectTab,
}: {
  disabled?: boolean;
  meta: Partial<Record<SettingsTab, ReactNode>>;
  onPrefetchTab?: (tab: SettingsTab) => void;
  onSelectTab?: (tab: SettingsTab) => void;
}) => {
  const showDevelopment = isDemoModeAvailable();
  const navItems = SETTINGS_NAV_ITEMS.filter(
    (item) => !("developmentOnly" in item && item.developmentOnly) || showDevelopment,
  );

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
                return (
                  <SettingsNavigationRow
                    description={description}
                    disabled={disabled}
                    icon={<HugeiconsIcon aria-hidden icon={SETTINGS_NAV_ICONS[tab]} />}
                    key={tab}
                    meta={meta[tab] ? <span>{meta[tab]}</span> : undefined}
                    onClick={() => onSelectTab?.(tab)}
                    onIntent={onPrefetchTab ? () => onPrefetchTab(tab) : undefined}
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
