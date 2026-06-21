"use client";

import { CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_PRODUCTS, type BillingProductId } from "@quieter/billing/plans";
import { Button, cn, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  formatBillingProduct,
  normalizeBillingProduct,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";
import { settingsRouteApi } from "~/lib/route-apis";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const ProductCard = ({
  canChoose = true,
  currentProduct,
  isStartingCheckout,
  onCheckout,
  productId,
}: {
  canChoose?: boolean;
  currentProduct: BillingProductId | null;
  isStartingCheckout: boolean;
  onCheckout: () => void;
  productId: BillingProductId;
}) => {
  const product = BILLING_PRODUCTS[productId];
  const isCurrent = currentProduct === productId;

  return (
    <article
      className={cn("rounded-xl border bg-background p-5", {
        "border-primary/50 bg-primary/4": isCurrent,
        "border-border/70": !isCurrent,
      })}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{product.name}</h3>
            {product.highlight && !isCurrent && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                AI included
              </span>
            )}
            {isCurrent && (
              <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary">
                Current
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm/6 text-muted-foreground">{product.description}</p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
            {product.features.map((feature) => (
              <li className="flex items-start gap-2" key={feature}>
                <HugeiconsIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-foreground/60"
                  icon={CheckmarkCircle02Icon}
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:items-end">
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {moneyFormatter.format(product.monthlyPriceCents / 100)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
          </p>
          <Button
            className="w-full sm:w-auto"
            disabled={!canChoose || isCurrent || isStartingCheckout}
            onClick={onCheckout}
            size="sm"
            variant={product.highlight ? "default" : "outline"}
          >
            {isStartingCheckout && (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            )}
            {isCurrent ? "Current billing" : canChoose ? "Choose" : "Owner or admin required"}
          </Button>
        </div>
      </div>
    </article>
  );
};

const CreditSummary = ({
  creditAmountCents,
  product,
  usage,
}: {
  creditAmountCents: number | null;
  product: BillingProductId | null;
  usage: { billableCostCents: number; costCents: number; remainingCreditCents: number } | null;
}) => (
  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
    <span>{formatBillingProduct(product)}</span>
    {creditAmountCents != null && (
      <span>
        {moneyFormatter.format((usage?.remainingCreditCents ?? creditAmountCents) / 100)} credits
        remaining
      </span>
    )}
    {!!usage?.billableCostCents && (
      <span>{moneyFormatter.format(usage.billableCostCents / 100)} overage</span>
    )}
  </div>
);

export const PlanSettingsPanel = () => {
  const navigate = useNavigate({ from: "/settings" });
  const { billing: billingResult } = settingsRouteApi.useSearch();
  const queryClient = useQueryClient();
  const {
    data: billing,
    error: billingError,
    isError: isBillingError,
    isPending: isBillingPending,
    refetch: refetchBilling,
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

  useEffect(() => {
    if (!billingResult) return;

    if (billingResult === "success") {
      toast.success("Billing updated. It may take a moment to sync.");
      void refetchBilling();
    } else {
      toast.message("Checkout canceled.");
    }

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, billing: undefined }),
      to: ".",
    });
  }, [billingResult, navigate, refetchBilling]);

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
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Billing</h1>
        <p className="mt-2 max-w-2xl text-sm/6 text-muted-foreground">
          Personal and team billing are separate. Every monthly payment becomes an equal credit
          balance used by AI, managed mail, and other paid usage.
        </p>
      </header>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">Personal</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your personal balance unlocks AI without affecting any organization.
          </p>
          <div className="mt-2">
            <CreditSummary
              creditAmountCents={billing.personal.creditAmountCents}
              product={personalProduct}
              usage={billing.personal.usage}
            />
          </div>
        </div>
        <ProductCard
          currentProduct={personalProduct}
          isStartingCheckout={
            checkoutMutation.isPending && checkoutMutation.variables?.product === "personal"
          }
          onCheckout={() => checkoutMutation.mutate({ product: "personal" })}
          productId="personal"
        />
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">Teams</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each organization has its own credits and feature access.
          </p>
        </div>

        {billing.teams.length === 0 ? (
          <p className="rounded-xl border border-border/70 p-5 text-sm text-muted-foreground">
            Create an organization to set up team billing.
          </p>
        ) : (
          <div className="space-y-8">
            {billing.teams.map((team) => {
              const currentProduct = normalizeBillingProduct(team.product);

              return (
                <div key={team.organizationId}>
                  <div className="mb-3">
                    <h3 className="font-medium text-foreground">{team.organizationName}</h3>
                    <CreditSummary
                      creditAmountCents={team.creditAmountCents}
                      product={currentProduct}
                      usage={team.usage}
                    />
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {(["team", "team_ai"] as const).map((product) => (
                      <ProductCard
                        canChoose={team.canManageBilling}
                        currentProduct={currentProduct}
                        isStartingCheckout={
                          checkoutMutation.isPending &&
                          checkoutMutation.variables?.organizationId === team.organizationId &&
                          checkoutMutation.variables.product === product
                        }
                        key={product}
                        onCheckout={() =>
                          checkoutMutation.mutate({
                            organizationId: team.organizationId,
                            product,
                          })
                        }
                        productId={product}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
