"use client";

import {
  BillingCreditSummary,
  BillingProductCard,
} from "@quieter/app/features/settings/components/billing-product-card";
import { ManagedUsageSummary } from "@quieter/app/features/settings/components/organization-settings/organization-mail-usage-settings";
import {
  SettingsCard,
  SettingsErrorState,
  SettingsInsetFieldRow,
  SettingsInsetRow,
  SettingsInsetRows,
  SettingsLoadingState,
  SettingsRowText,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import {
  getBillingStatusMessage,
  normalizeBillingProduct,
  userBillingQueryOptions,
  USER_BILLING_QUERY_KEY,
} from "@quieter/app/features/settings/domain/billing";
import type { UserBillingOverview } from "@quieter/app/features/settings/domain/billing";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { openExternalUrl } from "@quieter/app/runtime";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Fieldset } from "@quieter/ui/fieldset";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@quieter/ui/number-field";
import { Surface } from "@quieter/ui/surface";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type AccountBilling = UserBillingOverview["account"];

const periodFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
});

const AccountUsageSettings = ({
  settings,
}: {
  settings: AccountBilling["settings"];
}) => {
  const queryClient = useQueryClient();
  const [overageEnabled, setOverageEnabled] = useState(settings.overageEnabled);
  const savedLimitCents =
    settings.monthlyOverageLimitMicroCents === null
      ? null
      : settings.monthlyOverageLimitMicroCents / 1_000_000;
  const [limitDollars, setLimitDollars] = useState<number | null>(
    savedLimitCents === null ? null : savedLimitCents / 100
  );
  const limitCents =
    limitDollars === null ? null : Math.round(limitDollars * 100);
  const hasChanges =
    overageEnabled !== settings.overageEnabled ||
    limitCents !== savedLimitCents;
  const updateMutation = useMutation({
    ...orpc.billing.updateAccountUsageSettings.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "billing",
        fallback: "Could not save usage settings.",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: ["organization-mail-usage"],
        }),
      ]);
      toast.success("Usage settings saved.");
    },
  });

  return (
    <SettingsSection
      title="Account spending limits"
      description="These settings apply across every team you pay for. Team safety limits can stop usage sooner."
    >
      <Fieldset bare disabled={updateMutation.isPending}>
        <SettingsCard>
          <SettingsInsetRows>
            <SettingsInsetRow className="justify-between gap-6">
              <SettingsRowText
                title={
                  <label htmlFor="account-overage-toggle">Allow overage</label>
                }
              >
                Continue paid usage after your shared monthly balance runs out.
              </SettingsRowText>
              <Switch
                checked={overageEnabled}
                className="shrink-0"
                id="account-overage-toggle"
                onCheckedChange={setOverageEnabled}
              >
                <SwitchThumb />
              </Switch>
            </SettingsInsetRow>
            <SettingsInsetFieldRow>
              <SettingsRowText title="Monthly overage limit">
                Maximum extra spend across your teams each billing period.
              </SettingsRowText>
              <div className="flex items-center gap-2">
                <NumberField
                  disabled={!overageEnabled}
                  format={{
                    currency: "USD",
                    maximumFractionDigits: 2,
                    minimumFractionDigits: 2,
                    style: "currency",
                  }}
                  min={0}
                  onValueChange={setLimitDollars}
                  step={5}
                  value={limitDollars}
                >
                  <NumberFieldGroup className="w-44">
                    <NumberFieldDecrement />
                    <NumberFieldInput
                      aria-label="Account monthly overage limit"
                      placeholder="No limit"
                    />
                    <NumberFieldIncrement />
                  </NumberFieldGroup>
                </NumberField>
                <Button
                  disabled={!overageEnabled || limitDollars === null}
                  onClick={() => {
                    setLimitDollars(null);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Clear
                </Button>
              </div>
            </SettingsInsetFieldRow>
            <SettingsInsetRow>
              <ActionFooter>
                <Button
                  disabled={!hasChanges || updateMutation.isPending}
                  onClick={() => {
                    updateMutation.mutate({
                      monthlyOverageLimitCents: limitCents,
                      overageEnabled,
                    });
                  }}
                  pending={updateMutation.isPending}
                  pendingLabel="Saving…"
                  size="sm"
                >
                  Save changes
                </Button>
              </ActionFooter>
            </SettingsInsetRow>
          </SettingsInsetRows>
        </SettingsCard>
      </Fieldset>
    </SettingsSection>
  );
};

const AccountBillingContent = ({ account }: { account: AccountBilling }) => {
  const queryClient = useQueryClient();
  const currentProduct = normalizeBillingProduct(account.product);
  const statusMessage = getBillingStatusMessage(account);
  const checkoutMutation = useMutation({
    ...orpc.billing.createCheckout.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "billing",
        fallback: "Could not start checkout.",
      });
    },
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      await openExternalUrl(result.checkoutUrl);
    },
  });
  const portalMutation = useMutation({
    ...orpc.billing.createPortal.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "billing",
        fallback: "Could not open billing.",
      });
    },
    onSuccess: async (result) => {
      await openExternalUrl(result.portalUrl);
    },
  });
  return (
    <div className="@container space-y-6">
      <SettingsSection
        title="Your plan"
        description="One plan and one monthly usage balance across the teams you pay for. Gmail account slots stay separate for each team."
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <BillingCreditSummary
            creditAmountCents={account.creditAmountCents}
            product={currentProduct}
            usage={account.usage}
          />
          {account.hasBillingCustomer && (
            <Button
              disabled={portalMutation.isPending}
              onClick={() => {
                portalMutation.mutate({});
              }}
              size="sm"
              variant="secondary"
            >
              Manage billing
            </Button>
          )}
        </div>
        {statusMessage && (
          <p className="text-body text-muted-fg">{statusMessage}</p>
        )}
        {account.isClosing && (
          <p className="text-body text-muted-fg">
            Your account is closing. Manage your subscription or wait for
            pending usage to finish, then try deleting your account again.
          </p>
        )}
        {!account.hasUnlimitedAccess && (
          <Surface padding="none">
            {(["managed", "pro"] as const).map((product) => (
              <BillingProductCard
                compact
                canChoose={
                  !account.isClosing &&
                  (account.hasAccess ||
                    account.subscription === null ||
                    account.subscription.status === "canceled" ||
                    account.subscription.status === "expired")
                }
                currentProduct={account.hasAccess ? currentProduct : null}
                isAnyCheckoutPending={checkoutMutation.isPending}
                isStartingCheckout={
                  checkoutMutation.isPending &&
                  checkoutMutation.variables?.product === product
                }
                key={product}
                onCheckout={() => {
                  checkoutMutation.mutate({ product });
                }}
                productId={product}
              />
            ))}
          </Surface>
        )}
      </SettingsSection>

      {account.usage !== null && (
        <SettingsSection
          title="Shared usage"
          description={
            account.currentPeriodStart && account.currentPeriodEnd
              ? `${periodFormatter.format(new Date(account.currentPeriodStart))} to ${periodFormatter.format(new Date(account.currentPeriodEnd))}. Hover or focus a category to see each team's contribution.`
              : "Hover or focus a category to see each team's contribution."
          }
        >
          <ManagedUsageSummary
            includedUsageCents={account.creditAmountCents ?? 0}
            organizations={account.usage.organizations}
            rates={account.managedUsageRates}
            usage={{
              ...account.usage,
              managedUsageCostCents: account.usage.costCents,
            }}
          />
        </SettingsSection>
      )}
      {!account.hasUnlimitedAccess && account.hasAccess && (
        <AccountUsageSettings
          key={`${account.settings.overageEnabled}-${account.settings.monthlyOverageLimitMicroCents}`}
          settings={account.settings}
        />
      )}
    </div>
  );
};

export const AccountBillingPanel = () => {
  const billingQuery = useQuery(userBillingQueryOptions());
  if (billingQuery.isPending) {
    return <SettingsLoadingState label="Loading billing" />;
  }
  if (billingQuery.isError) {
    return (
      <SettingsErrorState
        message="Could not load billing."
        onRetry={() => {
          void billingQuery.refetch();
        }}
      />
    );
  }
  return <AccountBillingContent account={billingQuery.data.account} />;
};
