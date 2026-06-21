"use client";

import { toast } from "@quieter/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { USER_BILLING_QUERY_KEY } from "~/features/settings/domain/billing";
import { settingsRouteApi } from "~/lib/route-apis";

export const BillingCheckoutResult = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const { billing } = settingsRouteApi.useSearch();

  useEffect(() => {
    if (!billing) return;

    if (billing === "success") {
      toast.success("Billing updated. It may take a moment to sync.");
      void queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    } else {
      toast.message("Checkout canceled.");
    }

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, billing: undefined }),
      to: ".",
    });
  }, [billing, navigate, queryClient]);

  return null;
};
