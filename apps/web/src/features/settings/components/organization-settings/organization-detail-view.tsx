"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES, hasBillingPlanAccess } from "@quieter/billing/plans";
import { useQuery } from "@tanstack/react-query";
import type { OrganizationSettingsView } from "~/features/settings/domain/organization-settings-view";
import { normalizeBillingPlan, userBillingQueryOptions } from "~/features/settings/domain/billing";
import { ApiKeysView } from "./api-keys-view";
import {
  type OrganizationSummary,
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "./domain";
import { DomainsView } from "./domains-view";
import { MembersView } from "./members-view";
import { OrganizationOverviewView } from "./organization-overview-view";

export const OrganizationDetailView = ({
  onBackToList,
  onBackToOrganization,
  onOpenApiKeys,
  onOpenDomains,
  onOpenMembers,
  organization,
  userId,
  view,
}: {
  onBackToList: () => void;
  onBackToOrganization: () => void;
  onOpenApiKeys: () => void;
  onOpenDomains: () => void;
  onOpenMembers: () => void;
  organization: OrganizationSummary;
  userId: string;
  view: OrganizationSettingsView;
}) => {
  const fullOrganizationQuery = useQuery(fullOrganizationQueryOptions(organization.id));
  const billingQuery = useQuery(userBillingQueryOptions());
  const fullOrganization = fullOrganizationQuery.data;
  const activeMember = fullOrganization?.members.find((member) => member.userId === userId) ?? null;
  const activeRole = activeMember && normalizeOrganizationRole(activeMember.role);
  const pendingInvitations =
    fullOrganization?.invitations.filter((invitation) => invitation.status === "pending") ?? [];
  const canCancelInvitations = hasOrganizationPermission(activeRole, {
    invitation: ["cancel"],
  });
  const canDeleteOrganization = hasOrganizationPermission(activeRole, {
    organization: ["delete"],
  });
  const canInviteMembers = hasOrganizationPermission(activeRole, {
    invitation: ["create"],
  });
  const canRemoveMembers = hasOrganizationPermission(activeRole, {
    member: ["delete"],
  });
  const canUpdateMemberRole = hasOrganizationPermission(activeRole, {
    member: ["update"],
  });
  const canUpdateOrganization = hasOrganizationPermission(activeRole, {
    organization: ["update"],
  });
  const currentPlan = normalizeBillingPlan(billingQuery.data?.plan);
  const billingAccessUnknown = billingQuery.isError;
  const canUseOrganizationDomains =
    billingQuery.isSuccess &&
    (!!billingQuery.data?.hasUnlimitedAccess ||
      hasBillingPlanAccess(currentPlan, BILLING_FEATURES.organizationDomains.requiredPlan));
  const canUseOrganizationApiKeys =
    billingQuery.isSuccess &&
    (!!billingQuery.data?.hasUnlimitedAccess ||
      hasBillingPlanAccess(currentPlan, BILLING_FEATURES.organizationApiKeys.requiredPlan));
  const canUseOrganizationMail =
    billingQuery.isSuccess &&
    (!!billingQuery.data?.hasUnlimitedAccess ||
      hasBillingPlanAccess(currentPlan, BILLING_FEATURES.organizationMail.requiredPlan));

  if (fullOrganizationQuery.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        Loading organization…
      </div>
    );
  }

  if (fullOrganizationQuery.isError) {
    return (
      <p className="text-sm text-destructive">
        {fullOrganizationQuery.error.message ?? "Could not load organization."}
      </p>
    );
  }

  if (!fullOrganization) {
    return <p className="text-sm text-muted-foreground">Organization not found.</p>;
  }

  if (view === "members") {
    return (
      <MembersView
        activeMember={activeMember}
        permissions={{
          canCancelInvitations,
          canInviteMembers,
          canRemoveMembers,
          canUpdateMemberRole,
        }}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "domains") {
    return (
      <DomainsView
        billingAccessUnknown={billingAccessUnknown}
        canManageDomains={canUpdateOrganization}
        canUseOrganizationDomains={canUseOrganizationDomains}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "api-keys") {
    return (
      <ApiKeysView
        billingAccessUnknown={billingAccessUnknown}
        canManageApiKeys={canUpdateOrganization}
        canUseOrganizationApiKeys={canUseOrganizationApiKeys}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  return (
    <OrganizationOverviewView
      activeRole={activeRole}
      billingAccessUnknown={billingAccessUnknown}
      canDeleteOrganization={canDeleteOrganization}
      canUpdateOrganization={canUpdateOrganization}
      canUseOrganizationApiKeys={canUseOrganizationApiKeys}
      canUseOrganizationDomains={canUseOrganizationDomains}
      canUseOrganizationMail={canUseOrganizationMail}
      fullOrganization={fullOrganization}
      onBackToList={onBackToList}
      onOpenApiKeys={onOpenApiKeys}
      onOpenDomains={onOpenDomains}
      onOpenMembers={onOpenMembers}
      organization={organization}
      pendingInvitationsCount={pendingInvitations.length}
    />
  );
};
