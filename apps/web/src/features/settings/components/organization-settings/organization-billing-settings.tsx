"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "@quieter/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BillingCreditSummary,
  BillingProductCard,
} from "~/features/settings/components/billing-product-card";
import {
  normalizeBillingProduct,
  type UserBillingOverview,
  USER_BILLING_QUERY_KEY,
} from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";

export const OrganizationBillingSettings = ({
  billing,
  billingAccessUnknown,
  organizationId,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
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

  if (!billing && !billingAccessUnknown) {
    return (
      <section className="border-b border-border/70 py-6">
        <h2 className="text-sm font-medium text-foreground">Billing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Billing details are unavailable for this organization.
        </p>
      </section>
    );
  }

  if (!billing) {
    return (
      <section className="flex items-center gap-2 border-b border-border/70 py-6 text-sm text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-4" icon={Loading03Icon} />
        Could not load billing.
      </section>
    );
  }

  const currentProduct = normalizeBillingProduct(billing.product);

  return (
    <section className="border-b border-border/70 py-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">Billing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the shared monthly credits and features for this team.
        </p>
        <div className="mt-2">
          <BillingCreditSummary
            creditAmountCents={billing.creditAmountCents}
            product={currentProduct}
            usage={billing.usage}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {(["team", "team_ai"] as const).map((product) => (
          <BillingProductCard
            canChoose={billing.canManageBilling}
            currentProduct={currentProduct}
            isStartingCheckout={
              checkoutMutation.isPending && checkoutMutation.variables?.product === product
            }
            key={product}
            onCheckout={() => checkoutMutation.mutate({ organizationId, product })}
            productId={product}
          />
        ))}
      </div>
    </section>
  );
};
