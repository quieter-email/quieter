"use client";

import { CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  BILLING_PLANS,
  formatBillingPlan,
  formatBillingStatus,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";
import { settingsRouteApi } from "~/lib/route-apis";

export const PlanSettingsPanel = () => {
  const navigate = useNavigate({ from: "/settings" });
  const { billing: billingResult } = settingsRouteApi.useSearch();
  const queryClient = useQueryClient();
  const billingQuery = useQuery(userBillingQueryOptions());
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
      toast.success("Plan updated. It may take a moment to sync.");
      void billingQuery.refetch();
    } else {
      toast.message("Checkout canceled.");
    }

    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        billing: undefined,
      }),
      to: ".",
    });
  }, [billingQuery, billingResult, navigate]);

  const currentPlan = billingQuery.data?.plan ?? "free";
  const currentSubscription = billingQuery.data?.subscription ?? null;
  const isReady = !billingQuery.isPending && !billingQuery.isError;

  return (
    <div>
      <div className="pb-8">
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Plan</h1>
        <p className="mt-2 max-w-xl text-sm/6 text-muted-foreground">
          Gmail and BYOK are free forever. Upgrade your account for Quieter-managed mail, AI
          credits, and live Gmail infrastructure.
        </p>

        {isReady && (
          <div className="mt-5 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Current plan</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
              {formatBillingPlan(currentPlan)}
              {currentSubscription && (
                <span className="text-muted-foreground">
                  · {formatBillingStatus(currentSubscription.status)}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {billingQuery.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading your plan…
        </div>
      ) : billingQuery.isError ? (
        <p className="text-sm text-destructive">
          {billingQuery.error.message ?? "Could not load your plan."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {BILLING_PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.plan;
            const isFree = plan.plan === "free";
            const isStartingCheckout =
              checkoutMutation.isPending && checkoutMutation.variables?.plan === plan.plan;

            return (
              <article
                className={cn(
                  "rounded-xl border bg-background p-5 transition-colors",
                  isCurrent ? "border-primary/50 bg-primary/4" : "border-border/70",
                )}
                key={plan.plan}
              >
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">{plan.name}</h2>
                      {plan.highlight && !isCurrent && (
                        <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                          Popular
                        </span>
                      )}
                      {isCurrent && (
                        <span className="inline-flex items-center rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Current
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 text-sm/6 text-muted-foreground">{plan.description}</p>

                    <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
                      {plan.features.map((feature) => (
                        <li className="flex items-center gap-2" key={feature}>
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4 shrink-0 text-foreground/60"
                            icon={CheckmarkCircle02Icon}
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex shrink-0 flex-col gap-3 sm:items-end">
                    <p className="text-2xl font-semibold tracking-tight text-foreground">
                      {plan.price}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
                    </p>

                    {isCurrent ? (
                      <Button className="w-full sm:w-auto" disabled size="sm" variant="outline">
                        Current plan
                      </Button>
                    ) : isFree ? (
                      <span className="text-xs text-muted-foreground">
                        Included on every account
                      </span>
                    ) : (
                      <Button
                        className="w-full sm:w-auto"
                        disabled={checkoutMutation.isPending}
                        onClick={() => {
                          checkoutMutation.mutate({ plan: plan.plan });
                        }}
                        size="sm"
                        variant={plan.highlight ? "default" : "outline"}
                      >
                        {isStartingCheckout && (
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4 animate-spin"
                            icon={Loading03Icon}
                          />
                        )}
                        Upgrade
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
