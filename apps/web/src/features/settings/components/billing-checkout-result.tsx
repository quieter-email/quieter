"use client";

import { toast } from "@quieter/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { USER_BILLING_QUERY_KEY } from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";
import { settingsRouteApi } from "~/lib/route-apis";

export const BillingCheckoutResult = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const { billing, checkoutId } = settingsRouteApi.useSearch();
  const { mutate: syncCheckout } = useMutation({
    ...orpc.billing.syncCheckout.mutationOptions(),
    onError: () => {
      toast.error("We could not activate your plan. Please contact support.");
    },
    onSuccess: () => {
      toast.success("Your plan is active.");
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });

  useEffect(() => {
    if (!billing) return;

    if (billing === "success") {
      if (checkoutId) {
        syncCheckout({ checkoutId });
      } else {
        toast.success("Your purchase was completed.");
        void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      }
    } else {
      toast.message("Checkout canceled.");
    }

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, billing: undefined, checkoutId: undefined }),
      to: ".",
    });
  }, [billing, checkoutId, navigate, queryClient, syncCheckout]);

  return null;
};
