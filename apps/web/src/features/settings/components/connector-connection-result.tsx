"use client";

import { toast } from "@quieter/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CONNECTORS_QUERY_KEY } from "~/lib/connectors-query";
import { settingsRouteApi } from "~/lib/route-apis";

export const ConnectorConnectionResult = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const { connector } = settingsRouteApi.useSearch();

  useEffect(() => {
    if (!connector) return;

    if (connector === "connected") {
      toast.success("Connector connected.");
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY });
    } else {
      toast.error("Connector setup could not be completed.");
    }

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, connector: undefined }),
      to: ".",
    });
  }, [connector, navigate, queryClient]);

  return null;
};
