"use client";

import { fullOrganizationQueryOptions } from "@quieter/app/features/settings/components/organization-settings/domain";
import { userBillingQueryOptions } from "@quieter/app/features/settings/domain/billing";
import type { SettingsTab } from "@quieter/app/features/settings/domain/settings-tab";
import { authClient } from "@quieter/app/lib/auth";
import { connectorsQueryOptions } from "@quieter/app/lib/connectors-query";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { usePrefetchQuery } from "@tanstack/react-query";

const AccountDataPrefetch = () => {
  authClient.useListPasskeys();
  return null;
};

const OrganizationDetailPrefetch = ({
  organizationId,
}: {
  organizationId: string;
}) => {
  usePrefetchQuery(fullOrganizationQueryOptions(organizationId));
  return null;
};

const OrganizationDataPrefetch = () => {
  const organizations = authClient.useListOrganizations();

  return organizations.data?.map((organization) => (
    <OrganizationDetailPrefetch
      key={organization.id}
      organizationId={organization.id}
    />
  ));
};

export const SettingsDataPrefetch = ({ tab }: { tab: SettingsTab }) => {
  usePrefetchQuery(mailboxesQueryOptions());
  usePrefetchQuery(connectorsQueryOptions());
  usePrefetchQuery(userBillingQueryOptions());
  usePrefetchQuery(orpc.ai.settings.queryOptions());

  return (
    <>
      {tab === "overview" || tab === "account" ? <AccountDataPrefetch /> : null}
      {tab === "organization" ? <OrganizationDataPrefetch /> : null}
    </>
  );
};
