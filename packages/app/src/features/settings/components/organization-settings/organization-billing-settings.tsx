"use client";

import { BillingCreditSummary } from "@quieter/app/features/settings/components/billing-product-card";
import {
  SettingsCard,
  SettingsInsetRow,
  SettingsRowText,
} from "@quieter/app/features/settings/components/settings-layout";
import { normalizeBillingProduct } from "@quieter/app/features/settings/domain/billing";
import type { UserBillingOverview } from "@quieter/app/features/settings/domain/billing";
import { GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import { Button } from "@quieter/ui/button";
import { Link } from "@tanstack/react-router";

export const OrganizationBillingSettings = ({
  billing,
  billingAccessUnknown,
  billingPending,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
}) => {
  if (!billing) {
    let message = "Billing details are unavailable for this team.";
    if (billingPending) {
      message = "Loading the team's plan…";
    } else if (billingAccessUnknown) {
      message = "Could not load the team's plan.";
    }
    return (
      <SettingsCard>
        <SettingsInsetRow>
          <SettingsRowText title="Billing account">{message}</SettingsRowText>
        </SettingsInsetRow>
      </SettingsCard>
    );
  }

  const currentProduct = normalizeBillingProduct(billing.product);
  const gmailSlots = GMAIL_MAILBOX_LIMITS[currentProduct ?? "free"];

  return (
    <SettingsCard>
      <SettingsInsetRow className="justify-between gap-4">
        <SettingsRowText title="Billing account">
          {billing.billingOwnerIsCurrentUser
            ? "Your account plan and usage balance are shared across the teams you pay for."
            : `${billing.billingOwnerName}'s account plan covers this team. Contact them to change the plan or payment settings.`}
        </SettingsRowText>
        {billing.billingOwnerIsCurrentUser && (
          <Button
            nativeButton={false}
            render={<Link to="/settings" search={{ tab: "billing" }} />}
            size="sm"
            variant="secondary"
          >
            Personal billing
          </Button>
        )}
      </SettingsInsetRow>
      <SettingsInsetRow>
        <SettingsRowText title="Plan & shared balance">
          <BillingCreditSummary
            creditAmountCents={billing.creditAmountCents}
            product={currentProduct}
            usage={billing.usage}
          />
          <p className="mt-2">
            {gmailSlots} Gmail accounts per team. Gmail slots are not pooled.
          </p>
          {!billing.hasAccess && (
            <p className="mt-2">
              The billing account needs an active plan to restore sending and
              API access.
            </p>
          )}
        </SettingsRowText>
      </SettingsInsetRow>
    </SettingsCard>
  );
};
