"use client";

import { CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_PRODUCTS, type BillingProductId } from "@quieter/billing/plans";
import { Button, cn } from "@quieter/ui";
import { formatBillingProduct } from "~/features/settings/domain/billing";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

export const BillingProductCard = ({
  canChoose = true,
  currentProduct,
  isAnyCheckoutPending,
  isStartingCheckout,
  onCheckout,
  productId,
}: {
  canChoose?: boolean;
  currentProduct: BillingProductId | null;
  isAnyCheckoutPending: boolean;
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
            disabled={!canChoose || isCurrent || isAnyCheckoutPending}
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

export const BillingCreditSummary = ({
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
