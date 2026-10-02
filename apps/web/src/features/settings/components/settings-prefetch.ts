import type { QueryClient } from "@tanstack/react-query";

import type { SettingsTab } from "#/features/settings/domain/settings-tab";
import { connectorsQueryOptions } from "#/lib/connectors-query";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import { userBillingQueryOptions } from "../domain/billing";
import { managedMailboxSettingsQueryOptions } from "./managed-mailbox-settings-query";
import { organizationDivisionsQueryOptions } from "./organization-settings/divisions-query";
import { fullOrganizationQueryOptions } from "./organization-settings/domain";

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
