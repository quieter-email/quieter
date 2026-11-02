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

export const prefetchSettingsTab = async (
  queryClient: QueryClient,
  tab: SettingsTab
) => {
  switch (tab) {
    case "ai": {
      await Promise.allSettled([
        queryClient.query(orpc.ai.settings.queryOptions()),
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
