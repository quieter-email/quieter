"use client";

import type { UserBillingOverview } from "~/features/settings/domain/billing";
import { SettingsBackButton, SettingsCard } from "../settings-layout";
import { OrganizationBillingSettings } from "./organization-billing-settings";
import { OrganizationMailUsageSettings } from "./organization-mail-usage-settings";

export const OrganizationBillingView = ({
  billing,
  billingAccessUnknown,
  billingPending,
  canManageOrganizationMailUsage,
  canUseOrganizationMail,
  onBack,
  organizationId,
  organizationName,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageOrganizationMailUsage: boolean;
  canUseOrganizationMail: boolean;
  onBack: () => void;
  organizationId: string;
  organizationName: string;
}) => (
  <section className="space-y-6">
    <SettingsBackButton onClick={onBack}>{organizationName}</SettingsBackButton>

    <div>
      <h1 className="text-base font-semibold text-foreground">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Plans, usage balance, and overage controls.
      </p>
    </div>

    <SettingsCard>
      <OrganizationBillingSettings
        billing={billing}
        billingAccessUnknown={billingAccessUnknown}
        billingPending={billingPending}
        organizationId={organizationId}
      />

      <OrganizationMailUsageSettings
        billingAccessUnknown={billingAccessUnknown}
        billingPending={billingPending}
        canManageOrganizationMailUsage={canManageOrganizationMailUsage}
        canUseOrganizationMail={canUseOrganizationMail}
        organizationId={organizationId}
      />
    </SettingsCard>
  </section>
);
