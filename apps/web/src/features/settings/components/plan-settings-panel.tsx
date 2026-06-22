"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BillingCreditSummary,
  BillingProductCard,
} from "~/features/settings/components/billing-product-card";
import {
  normalizeBillingProduct,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";

export const PlanSettingsPanel = () => {
  const queryClient = useQueryClient();
  const {
    data: billing,
    error: billingError,
    isError: isBillingError,
    isPending: isBillingPending,
  } = useQuery(userBillingQueryOptions());
  const checkoutMutation = useMutation({
    ...orpc.billing.createCheckout.mutationOptions(),
    onError: (error) => {
      toast.error(error.message || "Could not start checkout.");
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      window.location.assign(result.checkoutUrl);
    },
  });
  const portalMutation = useMutation({
    ...orpc.billing.createPortal.mutationOptions(),
    onError: (error) => {
      toast.error(error.message || "Could not open billing.");
    },
    onSuccess: (result) => {
      window.location.assign(result.portalUrl);
    },
  });

  if (isBillingPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        Loading billing…
      </div>
    );
  }

  if (isBillingError) {
    return (
      <p className="text-sm text-destructive">
        {billingError.message ?? "Could not load billing."}
      </p>
    );
  }

  const personalProduct = normalizeBillingProduct(billing.personal.product);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-foreground">Personal plan</h1>
          <p className="mt-2 max-w-2xl text-sm/6 text-muted-foreground">
            Your personal plan and credits apply across your personal mailboxes. Team billing is
            managed from each team’s settings.
          </p>
        </div>
        {personalProduct && (
          <Button
            disabled={portalMutation.isPending}
            onClick={() => portalMutation.mutate({})}
            size="sm"
            variant="outline"
          >
            {portalMutation.isPending && (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            )}
            Manage billing
          </Button>
        )}
      </header>

      <section>
        <div className="mb-4">
          <BillingCreditSummary
            creditAmountCents={billing.personal.creditAmountCents}
            product={personalProduct}
            usage={billing.personal.usage}
          />
        </div>
        <BillingProductCard
          currentProduct={personalProduct}
          isAnyCheckoutPending={checkoutMutation.isPending}
          isStartingCheckout={
            checkoutMutation.isPending && checkoutMutation.variables?.product === "personal"
          }
          onCheckout={() => checkoutMutation.mutate({ product: "personal" })}
          productId="personal"
        />
      </section>
    </div>
  );
};
