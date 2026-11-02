"use client";

import { OrganizationBillingSettings } from "@quieter/app/features/settings/components/organization-settings/organization-billing-settings";
import { OrganizationMailUsageSettings } from "@quieter/app/features/settings/components/organization-settings/organization-mail-usage-settings";
import {
  SettingsPageHeader,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { useSettingsAnchor } from "@quieter/app/features/settings/components/use-settings-anchor";
import type { UserBillingOverview } from "@quieter/app/features/settings/domain/billing";

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
}) => {
  const { ref: usageRef } = useSettingsAnchor("usage");
  return (
    <section className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader title="Usage & limits" />

      <OrganizationBillingSettings
        billing={billing}
        billingAccessUnknown={billingAccessUnknown}
        billingPending={billingPending}
      />
      <div className="@container" ref={usageRef}>
        <OrganizationMailUsageSettings
          billingAccessUnknown={billingAccessUnknown}
          billingPending={billingPending}
          canManageOrganizationMailUsage={canManageOrganizationMailUsage}
          canUseOrganizationMail={canUseOrganizationMail}
          organizationId={organizationId}
        />
      </div>
    </section>
  );
};
