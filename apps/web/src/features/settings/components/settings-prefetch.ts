import type { RouterOutputs } from "@quieter/orpc";
import type { QueryClient } from "@tanstack/react-query";

import type { SettingsTab } from "#/features/settings/domain/settings-tab";
import { connectorsQueryOptions } from "#/lib/connectors-query";
import { mailboxActionsListQueryOptions } from "#/lib/mailbox-actions-query";
import {
  getMailboxesQueryKey,
  mailboxesQueryOptions,
} from "#/lib/mailboxes-query";
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

const settlePrefetches = async (prefetches: Promise<void>[]) => {
  await Promise.allSettled(prefetches);
};

export const prefetchSettingsTab = async (
  queryClient: QueryClient,
  tab: SettingsTab
) => {
  switch (tab) {
    case "ai": {
      await queryClient.prefetchQuery(orpc.ai.settings.queryOptions());
      return;
    }
    case "mailboxes": {
      await settlePrefetches([
        queryClient.prefetchQuery(mailboxesQueryOptions()),
        queryClient.prefetchQuery(userBillingQueryOptions()),
      ]);
      return;
    }
    case "actions": {
      const mailboxes = queryClient.getQueryData<
        RouterOutputs["mail"]["listMailboxes"]
      >(getMailboxesQueryKey());
      const firstActionableMailbox = mailboxes?.groups
        .flatMap((group) => group.mailboxes)
        .find(
          (mailbox) =>
            mailbox.provider === "gmail" || mailbox.provider === "managed"
        );

      await settlePrefetches([
        queryClient.prefetchQuery(mailboxesQueryOptions()),
        queryClient.prefetchQuery(connectorsQueryOptions()),
        ...(firstActionableMailbox
          ? [
              queryClient.prefetchQuery(
                mailboxActionsListQueryOptions(firstActionableMailbox.id)
              ),
            ]
          : []),
      ]);
      return;
    }
    case "connectors": {
      await queryClient.prefetchQuery(connectorsQueryOptions());
      return;
    }
    case "organization": {
      await queryClient.prefetchQuery(userBillingQueryOptions());
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
  await queryClient.prefetchQuery(fullOrganizationQueryOptions(organizationId));
};

export const prefetchOrganizationDivisions = async (
  queryClient: QueryClient,
  organizationId: string
) => {
  await queryClient.prefetchQuery(
    organizationDivisionsQueryOptions(organizationId)
  );
};

export const prefetchMailboxSettingsDetail = async (
  queryClient: QueryClient,
  mailbox: MailboxSettingsPrefetchTarget
) => {
  if (mailbox.provider !== "managed" || mailbox.grantRole !== "manager") {
    return;
  }

  await settlePrefetches([
    queryClient.prefetchQuery(
      fullOrganizationQueryOptions(mailbox.organizationId)
    ),
    queryClient.prefetchQuery(
      organizationDivisionsQueryOptions(mailbox.organizationId)
    ),
    queryClient.prefetchQuery(managedMailboxSettingsQueryOptions(mailbox.id)),
  ]);
};
