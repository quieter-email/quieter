"use client";

import type { UserBillingOverview } from "#/features/settings/domain/billing";

import { SettingsCard, SettingsSection } from "../settings-layout";
import { OrganizationBillingSettings } from "./organization-billing-settings";
import { OrganizationMailUsageSettings } from "./organization-mail-usage-settings";

export const OrganizationBillingView = ({
  billing,
  billingAccessUnknown,
  billingPending,
  canManageOrganizationMailUsage,
  canUseOrganizationMail,
  organizationId,
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
    <div>
      <h1 className="text-body-lg font-semibold text-fg">Billing</h1>
      <p className="mt-1 text-body text-muted-fg">
        Plans, usage balance, and overage controls.
      </p>
    </div>

    <SettingsSection title="Plan & credits">
      <SettingsCard>
        <OrganizationBillingSettings
          billing={billing}
          billingAccessUnknown={billingAccessUnknown}
          billingPending={billingPending}
          organizationId={organizationId}
        />
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title="Mail usage">
      <SettingsCard>
        <OrganizationMailUsageSettings
          billingAccessUnknown={billingAccessUnknown}
          billingPending={billingPending}
          canManageOrganizationMailUsage={canManageOrganizationMailUsage}
          canUseOrganizationMail={canUseOrganizationMail}
          organizationId={organizationId}
        />
      </SettingsCard>
    </SettingsSection>
  </section>
);
