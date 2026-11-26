"use client";

import { fullOrganizationQueryOptions } from "@quieter/app/features/settings/components/organization-settings/domain";
import { prefetchSettingsOverview } from "@quieter/app/features/settings/components/settings-prefetch";
import type { SettingsTab } from "@quieter/app/features/settings/domain/settings-tab";
import { authClient } from "@quieter/app/lib/auth";
import { usePrefetchQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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
  const queryClient = useQueryClient();
  useEffect(() => {
    void prefetchSettingsOverview(queryClient);
  }, [queryClient]);

  return (
    <>
      {tab === "overview" || tab === "account" ? <AccountDataPrefetch /> : null}
      {tab === "organization" ? <OrganizationDataPrefetch /> : null}
    </>
  );
};
