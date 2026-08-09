import { useQuery } from "@tanstack/react-query";

import { managedMailboxSettingsQueryOptions } from "#/features/settings/components/managed-mailbox-settings-query";
import { organizationDivisionsQueryOptions } from "#/features/settings/components/organization-settings/divisions-query";
import { fullOrganizationQueryOptions } from "#/features/settings/components/organization-settings/domain";
import { useMailboxDetailMutations } from "#/features/settings/components/use-mailbox-detail-mutations";
import {
  hasOrganizationAiAccess,
  userBillingQueryOptions,
} from "#/features/settings/domain/billing";
import { authClient } from "#/lib/auth";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";

const findMailboxGroup = (
  groups: { mailboxes: { id: string }[]; name: string }[],
  mailboxId: string
) =>
  groups.find((group) =>
    group.mailboxes.some((mailbox) => mailbox.id === mailboxId)
  );

const useManagedMailboxManagerData = (
  organizationId: string,
  mailboxId: string,
  enabled: boolean
) => {
  const { data: detailManagedOrganization } = useQuery({
    ...fullOrganizationQueryOptions(organizationId),
    enabled,
  });
  const { data: detailManagedDivisionsData } = useQuery({
    ...organizationDivisionsQueryOptions(organizationId),
    enabled,
  });
  const managedMailboxQuery = useQuery({
    ...managedMailboxSettingsQueryOptions(mailboxId),
    enabled,
  });

  return {
    detailManagedDivisions: detailManagedDivisionsData?.divisions ?? [],
    detailManagedMembers: detailManagedOrganization?.members ?? [],
    managedMailboxQuery,
  };
};

export const useMailboxDetailViewState = (mailboxId: string) => {
  const organizations = authClient.useListOrganizations().data ?? [];
  const placementItems = organizations.map((organization) => ({
    label: organization.name,
    value: organization.id,
  }));
  const { data: mailboxesData, isPending: areMailboxesPending } = useQuery(
    mailboxesQueryOptions()
  );
  const { data: billing, isSuccess: isBillingSuccess } = useQuery(
    userBillingQueryOptions()
  );
  const groups = mailboxesData?.groups ?? [];
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === mailboxId) ?? null;
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const isManagedManager =
    selectedMailbox?.provider === "managed" &&
    selectedMailbox.grantRole === "manager";
  const managedOrganizationId =
    selectedMailbox?.provider === "managed"
      ? selectedMailbox.organizationId
      : "";
  const { detailManagedDivisions, detailManagedMembers, managedMailboxQuery } =
    useManagedMailboxManagerData(
      managedOrganizationId,
      selectedMailbox?.id ?? "",
      isManagedManager
    );
  const mutations = useMailboxDetailMutations(selectedMailbox?.id);
  const detailGroup =
    selectedMailbox === null
      ? undefined
      : findMailboxGroup(groups, selectedMailbox.id);

  return {
    areMailboxesPending,
    defaultMailboxId,
    detailGroup,
    detailManagedDivisions,
    detailManagedMembers,
    hasAutomationAccess:
      isBillingSuccess &&
      selectedMailbox !== null &&
      hasOrganizationAiAccess(billing, selectedMailbox.organizationId),
    managedMailboxQuery,
    mutations,
    organizations,
    placementItems,
    selectedMailbox,
  };
};
