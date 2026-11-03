"use client";

import { USER_BILLING_QUERY_KEY } from "@quieter/app/features/settings/domain/billing";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const BillingCheckoutResult = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const { billing, checkoutId } = settingsRouteApi.useSearch();
  const { mutate: syncCheckout } = useMutation({
    ...orpc.billing.syncCheckout.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "billing",
        fallback: "Could not activate your plan.",
      });
    },
    onSuccess: () => {
      toast.success("Your plan is active.");
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: ["organization-mail-usage"],
      });
    },
  });

  useEffect(() => {
    if (!billing) {
      return;
    }

    if (billing === "success") {
      if (checkoutId === undefined || checkoutId === "") {
        toast.success("Your purchase was completed.");
        void queryClient.invalidateQueries({
          queryKey: USER_BILLING_QUERY_KEY,
        });
        void queryClient.invalidateQueries({
          queryKey: ["organization-mail-usage"],
        });
      } else {
        syncCheckout({ checkoutId });
      }
    } else {
      toast.message("Checkout canceled.");
    }

    void navigate({
      replace: true,
      search: (previous) => {
        const next = { ...previous, billing: undefined, checkoutId: undefined };
        Reflect.deleteProperty(next, "customer_session_token");
        return next;
      },
      to: ".",
    });
  }, [billing, checkoutId, navigate, queryClient, syncCheckout]);

  return null;
};
