"use client";

import { BillingCreditSummary } from "@quieter/app/features/settings/components/billing-product-card";
import {
  SettingsCard,
  SettingsInsetRow,
  SettingsRowText,
} from "@quieter/app/features/settings/components/settings-layout";
import {
  normalizeBillingProduct,
  USER_BILLING_QUERY_KEY,
} from "@quieter/app/features/settings/domain/billing";
import type { UserBillingOverview } from "@quieter/app/features/settings/domain/billing";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCloseButton,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

export const OrganizationBillingSettings = ({
  billing,
  billingAccessUnknown,
  billingPending,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
}) => {
  const queryClient = useQueryClient();
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const takeover = useMutation({
    ...orpc.billing.takeOverBilling.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "billing",
        fallback: "Could not take over billing.",
      });
    },
    onSuccess: async () => {
      setConfirmTakeover(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: ["organization-mail-usage"],
        }),
      ]);
    },
  });
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
      {billing.canTakeOverBilling && (
        <SettingsInsetRow className="justify-between gap-4">
          <SettingsRowText title="Pay from your account">
            Take responsibility for new usage for this team using your own plan
            and shared balance. Your account and team spending limits apply.
          </SettingsRowText>
          <Button
            size="sm"
            onClick={() => {
              setConfirmTakeover(true);
            }}
          >
            Take over billing
          </Button>
        </SettingsInsetRow>
      )}
      <AlertDialog
        open={confirmTakeover}
        onOpenChange={(open) => {
          if (!takeover.isPending) {
            setConfirmTakeover(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take over billing?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account plan and balance will fund new usage for this team.
              Overage follows your account and team spending limits. Previously
              authorized usage stays with the previous payer. If your account
              has no active plan, paid features will be unavailable until you
              choose one in Personal billing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCloseButton disabled={takeover.isPending}>
              Cancel
            </AlertDialogCloseButton>
            <Button
              pending={takeover.isPending}
              disabled={takeover.isPending}
              onClick={() => {
                takeover.mutate({ organizationId: billing.organizationId });
              }}
            >
              Take over billing
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SettingsInsetRow>
        <SettingsRowText
          title={
            billing.billingOwnerIsCurrentUser
              ? "Plan & shared balance"
              : "Team plan"
          }
        >
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
