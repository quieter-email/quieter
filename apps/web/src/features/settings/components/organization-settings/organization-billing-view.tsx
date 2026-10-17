"use client";

import { Tabs, TabsList, TabsTab, TabsPanel } from "@quieter/ui/tabs";

import type { UserBillingOverview } from "#/features/settings/domain/billing";
import { settingsRouteApi } from "#/lib/route-apis";

import {
  SettingsCard,
  SettingsPageHeader,
  settingsSurfaceVariants,
} from "../settings-layout";
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
  const { section } = settingsRouteApi.useSearch();
  const navigate = settingsRouteApi.useNavigate();
  return (
    <section className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader title="Billing">
        Plans, usage balance, and overage controls.
      </SettingsPageHeader>

      <Tabs
        value={section === "usage" ? "usage" : "plan"}
        onValueChange={(value) => {
          if (value === "plan" || value === "usage") {
            void navigate({
              search: (previous) => ({
                ...previous,
                section: value === "usage" ? "usage" : "plan",
              }),
              to: ".",
            });
          }
        }}
      >
        <TabsList aria-label="Billing sections" className="h-auto flex-wrap">
          <TabsTab value="plan">Plan & credits</TabsTab>
          <TabsTab value="usage">Mail usage</TabsTab>
        </TabsList>
        <TabsPanel value="plan">
          <SettingsCard>
            <OrganizationBillingSettings
              billing={billing}
              billingAccessUnknown={billingAccessUnknown}
              billingPending={billingPending}
              organizationId={organizationId}
            />
          </SettingsCard>
        </TabsPanel>
        <TabsPanel value="usage">
          <SettingsCard>
            <OrganizationMailUsageSettings
              billingAccessUnknown={billingAccessUnknown}
              billingPending={billingPending}
              canManageOrganizationMailUsage={canManageOrganizationMailUsage}
              canUseOrganizationMail={canUseOrganizationMail}
              organizationId={organizationId}
            />
          </SettingsCard>
        </TabsPanel>
      </Tabs>
    </section>
  );
};
