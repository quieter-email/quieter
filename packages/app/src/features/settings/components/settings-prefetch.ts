import { managedMailboxSettingsQueryOptions } from "@quieter/app/features/settings/components/managed-mailbox-settings-query";
import { organizationDivisionsQueryOptions } from "@quieter/app/features/settings/components/organization-settings/divisions-query";
import { fullOrganizationQueryOptions } from "@quieter/app/features/settings/components/organization-settings/domain";
import { userBillingQueryOptions } from "@quieter/app/features/settings/domain/billing";
import type { SettingsTab } from "@quieter/app/features/settings/domain/settings-tab";
import { connectorsQueryOptions } from "@quieter/app/lib/connectors-query";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import type { QueryClient } from "@tanstack/react-query";

export type MailboxSettingsPrefetchTarget = {
  grantRole?: string | null;
  id: string;
  organizationId: string;
  provider: string;
};

export const loadPreferenceSettingsPanels = async () =>
  await import("@quieter/app/features/settings/components/preference-settings-panels");

export const loadAccountSettingsPanel = async () => {
  const { AccountSettingsPanel: component } =
    await import("@quieter/app/features/settings/components/account-settings-panel");
  return { default: component };
};

export const loadAccountBillingPanel = async () => {
  const { AccountBillingPanel: component } =
    await import("@quieter/app/features/settings/components/account-billing-panel");
  return { default: component };
};

export const loadAiSettingsPanel = async () => {
  const { AiSettingsPanel: component } =
    await import("@quieter/app/features/settings/components/ai-settings-panel");
  return { default: component };
};

export const loadConnectorsSettingsPanel = async () => {
  const { ConnectorsSettingsPanel: component } =
    await import("@quieter/app/features/settings/components/connectors-settings-panel");
  return { default: component };
};

export const loadMailboxesSettingsPanel = async () => {
  const { MailboxesSettingsPanel: component } =
    await import("@quieter/app/features/settings/components/mailboxes-settings-panel");
  return { default: component };
};

export const loadOrganizationSettingsPanel = async () => {
  const { OrganizationSettingsPanel: component } =
    await import("@quieter/app/features/settings/components/organization-settings-panel");
  return { default: component };
};

export const loadSettingsTabPanel = async (tab: SettingsTab) => {
  switch (tab) {
    case "account": {
      await loadAccountSettingsPanel();
      return;
    }
    case "ai": {
      await loadAiSettingsPanel();
      return;
    }
    case "billing": {
      await loadAccountBillingPanel();
      return;
    }
    case "connectors": {
      await loadConnectorsSettingsPanel();
      return;
    }
    case "mailboxes": {
      await loadMailboxesSettingsPanel();
      return;
    }
    case "organization": {
      await loadOrganizationSettingsPanel();
      return;
    }
    case "appearance":
    case "development":
    case "overview":
    case "privacy":
    case "reading":
    case "shortcuts": {
      await loadPreferenceSettingsPanels();
      return;
    }
    default: {
      const _exhaustive: never = tab;
      void _exhaustive;
      break;
    }
  }
};

export const AI_SETTINGS_STALE_TIME = 60_000;

export const prefetchSettingsOverview = async (queryClient: QueryClient) => {
  await Promise.allSettled([
    queryClient.query(mailboxesQueryOptions()),
    queryClient.query(connectorsQueryOptions()),
    queryClient.query(userBillingQueryOptions()),
    queryClient.query(
      orpc.ai.settings.queryOptions({ staleTime: AI_SETTINGS_STALE_TIME })
    ),
  ]);
};

export const prefetchSettingsTab = async (
  queryClient: QueryClient,
  tab: SettingsTab
) => {
  switch (tab) {
    case "ai": {
      await Promise.allSettled([
        queryClient.query(
          orpc.ai.settings.queryOptions({ staleTime: AI_SETTINGS_STALE_TIME })
        ),
      ]);
      return;
    }
    case "mailboxes": {
      await Promise.allSettled([
        queryClient.query(mailboxesQueryOptions()),
        queryClient.query(userBillingQueryOptions()),
      ]);
      return;
    }
    case "connectors": {
      await Promise.allSettled([queryClient.query(connectorsQueryOptions())]);
      return;
    }
    case "billing":
    case "organization": {
      await Promise.allSettled([queryClient.query(userBillingQueryOptions())]);
      break;
    }
    case "account":
    case "appearance":
    case "development":
    case "overview":
    case "privacy":
    case "reading":
    case "shortcuts": {
      break;
    }
    default: {
      break;
    }
  }
};

export const warmSettingsTab = async (
  queryClient: QueryClient,
  tab: SettingsTab,
  isSandboxMode: boolean
) => {
  await Promise.allSettled([
    loadSettingsTabPanel(tab),
    isSandboxMode ? undefined : prefetchSettingsTab(queryClient, tab),
  ]);
};

export const prefetchOrganizationSettingsDetail = async (
  queryClient: QueryClient,
  organizationId: string
) => {
  await Promise.allSettled([
    queryClient.query(fullOrganizationQueryOptions(organizationId)),
  ]);
};

export const prefetchOrganizationDivisions = async (
  queryClient: QueryClient,
  organizationId: string
) => {
  await Promise.allSettled([
    queryClient.query(organizationDivisionsQueryOptions(organizationId)),
  ]);
};

export const prefetchMailboxSettingsDetail = async (
  queryClient: QueryClient,
  mailbox: MailboxSettingsPrefetchTarget
) => {
  if (mailbox.provider !== "managed" || mailbox.grantRole !== "manager") {
    return;
  }

  await Promise.allSettled([
    queryClient.query(fullOrganizationQueryOptions(mailbox.organizationId)),
    queryClient.query(
      organizationDivisionsQueryOptions(mailbox.organizationId)
    ),
    queryClient.query(managedMailboxSettingsQueryOptions(mailbox.id)),
  ]);
};
