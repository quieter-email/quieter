"use client";

import { toast } from "@quieter/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { toastError } from "#/lib/error-toast";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { settingsRouteApi } from "#/lib/route-apis";

export const GmailConnectionResult = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const { gmail } = settingsRouteApi.useSearch();
  const { gmailError } = settingsRouteApi.useLoaderData();

  useEffect(() => {
    if (!gmail) {
      return;
    }

    if (gmail === "connected") {
      toast.success("Gmail connected.");
      void queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    } else {
      toastError(gmailError, {
        boundary: "gmail-connect",
        fallback: "Gmail connection didn't finish. Choose Gmail to try again.",
        report: false,
      });
    }

    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        gmail: undefined,
        ...(gmail === "error" && previous.mailboxId === ""
          ? { mailboxView: "add" as const }
          : {}),
      }),
      to: ".",
    });
  }, [gmail, gmailError, navigate, queryClient]);

  return null;
};
