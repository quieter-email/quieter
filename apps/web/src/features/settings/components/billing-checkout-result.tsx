"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "@quieter/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { USER_BILLING_QUERY_KEY } from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";
import { settingsRouteApi } from "~/lib/route-apis";

export const BillingCheckoutResult = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const { billing, checkoutId } = settingsRouteApi.useSearch();
  const hasStartedSyncRef = useRef(false);

  const { mutate: syncCheckout, isPending } = useMutation({
    ...orpc.billing.syncCheckout.mutationOptions(),
    onError: (error) => {
      toast.error(error.message || "Failed to synchronize subscription.");
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, billing: undefined, checkoutId: undefined }),
        to: ".",
      });
    },
    onSuccess: () => {
      toast.success("Billing updated successfully.");
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, billing: undefined, checkoutId: undefined }),
        to: ".",
      });
    },
  });

  useEffect(() => {
    if (!billing) return;

    if (billing === "success") {
      if (checkoutId) {
        if (!hasStartedSyncRef.current) {
          hasStartedSyncRef.current = true;
          syncCheckout({ checkoutId });
        }
      } else {
        toast.success("Billing updated.");
        void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
        void navigate({
          replace: true,
          search: (previous) => ({ ...previous, billing: undefined, checkoutId: undefined }),
          to: ".",
        });
      }
    } else {
      toast.message("Checkout canceled.");
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, billing: undefined, checkoutId: undefined }),
        to: ".",
      });
    }
  }, [billing, checkoutId, navigate, queryClient, syncCheckout]);

  if (billing === "success" && checkoutId && isPending) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
        <HugeiconsIcon
          aria-hidden
          className="size-8 animate-spin text-primary"
          icon={Loading03Icon}
        />
        <p className="mt-4 text-sm font-medium text-foreground">
          Synchronizing your subscription...
        </p>
      </div>
    );
  }

  return null;
};
