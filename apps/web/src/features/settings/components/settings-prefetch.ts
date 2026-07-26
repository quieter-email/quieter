import type { RouterOutputs } from "@quieter/orpc";
import type { QueryClient } from "@tanstack/react-query";
import type { SettingsTab } from "~/features/settings/domain/settings-tab";
import { connectorsQueryOptions } from "~/lib/connectors-query";
import { mailboxActionsListQueryOptions } from "~/lib/mailbox-actions-query";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
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

const settlePrefetches = (prefetches: Array<Promise<void>>) =>
  Promise.allSettled(prefetches).then(() => undefined);

export const prefetchSettingsTab = (queryClient: QueryClient, tab: SettingsTab) => {
  switch (tab) {
    case "ai":
      return queryClient.prefetchQuery(orpc.ai.settings.queryOptions());
    case "mailboxes":
      return settlePrefetches([
        queryClient.prefetchQuery(mailboxesQueryOptions()),
        queryClient.prefetchQuery(userBillingQueryOptions()),
      ]);
    case "actions": {
      const mailboxes =
        queryClient.getQueryData<RouterOutputs["mail"]["listMailboxes"]>(getMailboxesQueryKey());
      const firstActionableMailbox = mailboxes?.groups
        .flatMap((group) => group.mailboxes)
        .find((mailbox) => mailbox.provider === "gmail" || mailbox.provider === "managed");

      return settlePrefetches([
        queryClient.prefetchQuery(mailboxesQueryOptions()),
        queryClient.prefetchQuery(connectorsQueryOptions()),
        ...(firstActionableMailbox
          ? [queryClient.prefetchQuery(mailboxActionsListQueryOptions(firstActionableMailbox.id))]
          : []),
      ]);
    }
    case "connectors":
      return queryClient.prefetchQuery(connectorsQueryOptions());
    case "organization":
      return queryClient.prefetchQuery(userBillingQueryOptions());
    default:
      return Promise.resolve();
  }
};

export const prefetchOrganizationSettingsDetail = (
  queryClient: QueryClient,
  organizationId: string,
) => queryClient.prefetchQuery(fullOrganizationQueryOptions(organizationId));

export const prefetchOrganizationDivisions = (queryClient: QueryClient, organizationId: string) =>
  queryClient.prefetchQuery(organizationDivisionsQueryOptions(organizationId));

export const prefetchMailboxSettingsDetail = (
  queryClient: QueryClient,
  mailbox: MailboxSettingsPrefetchTarget,
) => {
  if (mailbox.provider !== "managed" || mailbox.grantRole !== "manager") {
    return Promise.resolve();
  }

  return settlePrefetches([
    queryClient.prefetchQuery(fullOrganizationQueryOptions(mailbox.organizationId)),
    queryClient.prefetchQuery(organizationDivisionsQueryOptions(mailbox.organizationId)),
    queryClient.prefetchQuery(managedMailboxSettingsQueryOptions(mailbox.id)),
  ]);
};
