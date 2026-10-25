"use client";

import {
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import {
  SettingsCard,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { formatBillingProduct } from "@quieter/app/features/settings/domain/billing";
import { BILLING_PRODUCTS, GMAIL_MAILBOX_LIMITS } from "@quieter/billing/plans";
import type { BillingProductId } from "@quieter/billing/plans";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { Pill } from "@quieter/ui/pill";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

export const BillingProductCard = ({
  canChoose = true,
  currentProduct,
  compact = false,
  isAnyCheckoutPending,
  isStartingCheckout,
  onCheckout,
  productId,
}: {
  canChoose?: boolean;
  compact?: boolean;
  currentProduct: BillingProductId | null;
  isAnyCheckoutPending: boolean;
  isStartingCheckout: boolean;
  onCheckout: () => void;
  productId: BillingProductId;
}) => {
  const product = BILLING_PRODUCTS[productId];
  const isCurrent = currentProduct === productId;

  const checkoutButton = (
    <Button
      className={cn("shrink-0", { "w-full sm:w-auto": !compact })}
      disabled={!canChoose || isCurrent || isAnyCheckoutPending}
      onClick={onCheckout}
      size="sm"
      variant={product.highlight ? "default" : "outline"}
    >
      {isStartingCheckout && (
        <Icon aria-hidden animation="spin" icon={Loading03Icon} />
      )}
      {(() => {
        if (isCurrent) {
          return "Current billing";
        }
        if (canChoose) {
          return "Choose";
        }
        return "Owner or admin required";
      })()}
    </Button>
  );

  if (compact) {
    return (
      <article className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex items-center gap-2">
            <h3 className="text-body-sm font-medium text-fg">{product.name}</h3>
            {isCurrent && (
              <span className="text-caption text-muted-fg">Current</span>
            )}
          </div>
          <p className="mt-0.5 text-caption text-muted-fg">
            {moneyFormatter.format(product.creditAmountCents / 100)} monthly
            balance, {GMAIL_MAILBOX_LIMITS[productId]} Gmail accounts
            {productId === "pro" ? ", includes AI" : ", domains & API keys"}
          </p>
        </div>
        <p className="shrink-0 text-body-sm font-medium text-fg">
          {moneyFormatter.format(product.monthlyPriceCents / 100)}
          <span className="font-normal text-muted-fg">/mo</span>
        </p>
        {isCurrent ? null : checkoutButton}
      </article>
    );
  }

  return (
    <SettingsCard
      className={cn(settingsSurfaceVariants({ variant: "body" }), {
        "border-primary/50 bg-primary/4": isCurrent,
      })}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={settingsSurfaceVariants({ variant: "title" })}>
              {product.name}
            </h3>
            {isCurrent && (
              <Pill size="xs" tone="blue">
                Current
              </Pill>
            )}
          </div>
          <p className="mt-1.5 text-body/6 text-muted-fg">
            {product.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:items-end">
          <p className="text-title-md font-semibold tracking-tight text-fg">
            {moneyFormatter.format(product.monthlyPriceCents / 100)}
            <span className="ml-1 text-body font-normal text-muted-fg">
              /mo
            </span>
          </p>
          {checkoutButton}
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-2 text-body text-muted-fg">
        {product.features.map((feature) => (
          <li className="flex items-start gap-2" key={feature}>
            <Icon
              aria-hidden
              tone="subtle"
              className="mt-0.5"
              icon={CheckmarkCircle02Icon}
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
};

export const BillingCreditSummary = ({
  creditAmountCents,
  product,
  usage,
}: {
  creditAmountCents: number | null;
  product: BillingProductId | null;
  usage: {
    billableCostCents: number;
    costCents: number;
    remainingCreditCents: number;
  } | null;
}) => (
  <div
    className={cn(
      "flex flex-wrap gap-x-5 gap-y-1",
      settingsSurfaceVariants({ variant: "value" })
    )}
  >
    <span>{formatBillingProduct(product)}</span>
    {creditAmountCents !== null && creditAmountCents !== undefined && (
      <span>
        {moneyFormatter.format(
          (usage?.remainingCreditCents ?? creditAmountCents) / 100
        )}{" "}
        usage balance remaining
      </span>
    )}
    {(usage?.billableCostCents ?? 0) > 0 && (
      <span>
        {moneyFormatter.format((usage?.billableCostCents ?? 0) / 100)} overage
      </span>
    )}
  </div>
);
