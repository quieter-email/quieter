"use client";

import type { UserBillingOverview } from "#/features/settings/domain/billing";

import { useSettingsAnchor } from "../use-settings-anchor";
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
}) => {
  const { ref: usageRef } = useSettingsAnchor("usage");
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-body-lg font-semibold text-fg">Billing</h1>
      </div>

      <OrganizationBillingSettings
        billing={billing}
        billingAccessUnknown={billingAccessUnknown}
        billingPending={billingPending}
        organizationId={organizationId}
      />
      <div className="@container border-t border-border/70 pt-4" ref={usageRef}>
        <div className="-mx-4 md:-mx-6">
          <OrganizationMailUsageSettings
            billingAccessUnknown={billingAccessUnknown}
            billingPending={billingPending}
            canManageOrganizationMailUsage={canManageOrganizationMailUsage}
            canUseOrganizationMail={canUseOrganizationMail}
            organizationId={organizationId}
          />
        </div>
      </div>
    </section>
  );
};
