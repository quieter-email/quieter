"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import {
  BillingCreditSummary,
  BillingProductCard,
} from "@quieter/app/features/settings/components/billing-product-card";
import {
  SettingsRowText,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import {
  normalizeBillingProduct,
  getBillingStatusMessage,
  USER_BILLING_QUERY_KEY,
} from "@quieter/app/features/settings/domain/billing";
import type { UserBillingOverview } from "@quieter/app/features/settings/domain/billing";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { openExternalUrl } from "@quieter/app/runtime";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const OrganizationBillingSettings = ({
  billing,
  billingAccessUnknown,
  billingPending,
  organizationId,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
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

  if (billingPending) {
    return (
      <section
        className={cn(
          settingsSurfaceVariants({ variant: "insetSection" }),
          "flex items-center gap-2",
          settingsSurfaceVariants({ variant: "value" })
        )}
      >
        <Icon aria-hidden animation="spin" icon={Loading03Icon} />
        Loading billing…
      </section>
    );
  }

  if (!billing && !billingAccessUnknown) {
    return (
      <section className={settingsSurfaceVariants({ variant: "insetSection" })}>
        <SettingsRowText title="Billing">
          Billing details are unavailable for this team.
        </SettingsRowText>
      </section>
    );
  }

  if (!billing) {
    return (
      <section
        className={cn(
          settingsSurfaceVariants({ variant: "insetSection" }),
          "flex items-center gap-2",
          settingsSurfaceVariants({ variant: "value" })
        )}
      >
        <Icon aria-hidden icon={Loading03Icon} />
        Could not load billing.
      </section>
    );
  }

  const currentProduct = normalizeBillingProduct(billing.product);
  const statusMessage = getBillingStatusMessage(billing);

  return (
    <section className="@container">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SettingsRowText title="Plan & balance">
          <BillingCreditSummary
            creditAmountCents={billing.creditAmountCents}
            product={currentProduct}
            usage={billing.usage}
          />
        </SettingsRowText>
        {(currentProduct !== null || billing.subscription !== null) &&
          billing.canManageBilling && (
            <Button
              disabled={portalMutation.isPending}
              onClick={() => {
                portalMutation.mutate({ organizationId });
              }}
              size="sm"
              variant="outline"
            >
              {portalMutation.isPending && (
                <Icon aria-hidden animation="spin" icon={Loading03Icon} />
              )}
              Manage billing
            </Button>
          )}
      </div>

      {statusMessage !== null && (
        <output className="mt-4 block text-body text-muted-fg">
          {statusMessage}
        </output>
      )}
      {!billing.hasAccess && billing.subscription !== null && (
        <p className="mt-2 text-body text-muted-fg">
          Your domains, keys, and existing mail are kept. Incoming mail
          continues for configured inboxes. You can remove domains and keys in
          settings.
        </p>
      )}

      <div className="mt-3 divide-y divide-border border-t border-border">
        {(["managed", "pro"] as const).map((product) => (
          <BillingProductCard
            compact
            canChoose={
              billing.canManageBilling &&
              (billing.hasAccess ||
                billing.subscription === null ||
                billing.subscription.status === "canceled" ||
                billing.subscription.status === "expired")
            }
            currentProduct={currentProduct}
            isAnyCheckoutPending={checkoutMutation.isPending}
            isStartingCheckout={
              checkoutMutation.isPending &&
              checkoutMutation.variables?.product === product
            }
            key={product}
            onCheckout={() => {
              checkoutMutation.mutate({ organizationId, product });
            }}
            productId={product}
          />
        ))}
      </div>
    </section>
  );
};
