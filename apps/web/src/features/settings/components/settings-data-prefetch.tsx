"use client";

import { usePrefetchQuery } from "@tanstack/react-query";
import type { SettingsTab } from "~/features/settings/domain/settings-tab";
import { authClient } from "~/lib/auth";
import { connectorsQueryOptions } from "~/lib/connectors-query";
import { mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { userBillingQueryOptions } from "../domain/billing";
import { fullOrganizationQueryOptions } from "./organization-settings/domain";

const AccountDataPrefetch = () => {
  authClient.useListPasskeys();
  return null;
};

const OrganizationDetailPrefetch = ({ organizationId }: { organizationId: string }) => {
  usePrefetchQuery(fullOrganizationQueryOptions(organizationId));
  return null;
};

const OrganizationDataPrefetch = () => {
  const organizations = authClient.useListOrganizations();

  return organizations.data?.map((organization) => (
    <OrganizationDetailPrefetch key={organization.id} organizationId={organization.id} />
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
