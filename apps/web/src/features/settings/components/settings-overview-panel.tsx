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
import type { ReactNode } from "react";

import { isDemoModeAvailable } from "#/features/settings/domain/demo-mode-setting";
import {
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_LABELS,
} from "#/features/settings/domain/settings-navigation";
import type { SettingsNavSection } from "#/features/settings/domain/settings-navigation";
import type { SettingsTab } from "#/features/settings/domain/settings-tab";
import { authClient } from "#/lib/auth";
import { connectorsQueryOptions } from "#/lib/connectors-query";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";

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
    mailboxesData?.groups.reduce(
      (total, group) => total + group.mailboxes.length,
      0
    ) ?? 0;
  const connectedConnectorCount =
    connectorsData?.connectors.filter(
      (connector) => connector.status === "connected"
    ).length ?? 0;
  const sessionUser = authClient.useSession().data?.user;
  const user = {
    email: sessionUser?.email ?? initialUser.email,
    name: sessionUser?.name ?? initialUser.name,
  };
  let connectorsMeta: ReactNode = (
    <SettingsInlineLoading label="Loading connectors" />
  );
  if (connectorsData) {
    connectorsMeta =
      connectedConnectorCount === 1
        ? "1 Connected"
        : `${connectedConnectorCount} Connected`;
  }
  let mailboxesMeta: ReactNode = (
    <SettingsInlineLoading label="Loading mailboxes" />
  );
  if (mailboxesData) {
    mailboxesMeta =
      mailboxCount === 1 ? "1 Mailbox" : `${mailboxCount} Mailboxes`;
  }
  let organizationMeta: ReactNode;
  if (organizationsState.isPending) {
    organizationMeta = <SettingsInlineLoading label="Loading teams" />;
  } else {
    organizationMeta =
      organizations.length === 1 ? "1 Team" : `${organizations.length} Teams`;
  }
  const meta: Partial<Record<SettingsTab, ReactNode>> = {
    account: user.name || <SettingsInlineLoading label="Loading account" />,
    connectors: connectorsMeta,
    mailboxes: mailboxesMeta,
    organization: organizationMeta,
  };

  return (
    <SettingsOverviewContent
      meta={meta}
      onPrefetchTab={onPrefetchTab}
      onSelectTab={onSelectTab}
    />
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
    (item) =>
      !("developmentOnly" in item && item.developmentOnly) || showDevelopment
  );

  return (
    <div className="w-full space-y-8">
      <SettingsPageHeader title="Settings" />

      {SETTINGS_SECTIONS.map((section) => {
        const items = navItems.filter((item) => item.section === section);
        if (items.length === 0) {
          return null;
        }

        return (
          <SettingsSection
            key={section}
            title={SETTINGS_SECTION_LABELS[section]}
          >
            <SettingsRows>
              {items.map(({ tab, title, description }) => (
                <SettingsNavigationRow
                  description={description}
                  disabled={disabled}
                  icon={
                    <HugeiconsIcon aria-hidden icon={SETTINGS_NAV_ICONS[tab]} />
                  }
                  key={tab}
                  meta={
                    meta[tab] !== null && meta[tab] !== undefined ? (
                      <span>{meta[tab]}</span>
                    ) : undefined
                  }
                  onClick={() => onSelectTab?.(tab)}
                  onIntent={
                    onPrefetchTab
                      ? () => {
                          onPrefetchTab(tab);
                        }
                      : undefined
                  }
                  title={title}
                />
              ))}
            </SettingsRows>
          </SettingsSection>
        );
      })}
    </div>
  );
};
