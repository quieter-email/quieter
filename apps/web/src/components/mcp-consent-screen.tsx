"use client";

import { AuthLayout } from "@quieter/app/components/auth-layout";
import { signOut } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { appFetch } from "@quieter/app/runtime";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { useMutation } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { z } from "zod";

const routeApi = getRouteApi("/_app/oauth/consent");
const consentResponseSchema = z.object({ url: z.string().min(1) });

export const McpConsentScreen = () => {
  const { consent, email, userId } = routeApi.useLoaderData();
  const search = routeApi.useSearch();
  const loginHref = `/oauth/login?${new URLSearchParams(search)}`;

  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- The page leaves for the connecting app after a decision.
  const decisionMutation = useMutation({
    mutationFn: async (accept: boolean) => {
      const response = await appFetch("/api/auth/oauth2/consent", {
        body: JSON.stringify({
          accept,
          expectedUserId: userId,
          oauth_query: consent?.query,
        }),
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Could not finish connecting the app.");
      }
      return consentResponseSchema.parse(await response.json()).url;
    },
    mutationKey: ["auth", "mcp", "consent"],
    onError: (error) => {
      toastError(error, {
        boundary: "mcp-consent",
        fallback: "Could not finish. Start again from the app.",
      });
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Signing out clears every cached query.
  const switchAccountMutation = useMutation({
    mutationFn: signOut,
    mutationKey: ["auth", "mcp", "switch-account"],
    onError: (error) => {
      toastError(error, { boundary: "mcp-switch-account" });
    },
    onSuccess: () => {
      window.location.assign(loginHref);
    },
  });

  if (consent === null) {
    return (
      <AuthLayout title="This request expired">
        <p className="mt-4 text-center text-body text-muted-fg">
          Start connecting again from the app you were using.
        </p>
      </AuthLayout>
    );
  }

  const isBusy =
    decisionMutation.isPending ||
    decisionMutation.isSuccess ||
    switchAccountMutation.isPending;

  return (
    <AuthLayout title={`Connect ${consent.clientName}?`}>
      <p className="mt-4 text-center text-body text-muted-fg">
        Signed in as {email}
      </p>
      <Surface className="mt-6">
        <div className="grid gap-3">
          <Text size="sm">This app will be able to act as you in quieter:</Text>
          <ul className="grid list-disc gap-1 pl-4 text-body-sm text-muted-fg">
            <li>Read, organize, and delete mail in your mailboxes</li>
            <li>Draft and send mail for you</li>
            <li>
              Manage teams, member access, calendars, and billing settings
            </li>
          </ul>
          <Text size="sm" tone="muted">
            {consent.staysConnected
              ? "It stays connected until you disconnect it in account settings."
              : "It stays connected until you sign out."}
          </Text>
        </div>
      </Surface>
      <p className="mt-4 text-caption text-muted-fg">
        quieter has not verified this app. You will be sent to{" "}
        <span className="font-medium wrap-anywhere text-fg">
          {consent.destination}
        </span>
        . Only continue if you started this.
      </p>
      <ActionFooter className="mt-6">
        <Button
          disabled={isBusy}
          onClick={() => {
            decisionMutation.mutate(false);
          }}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={isBusy}
          onClick={() => {
            decisionMutation.mutate(true);
          }}
          type="button"
        >
          Connect
        </Button>
      </ActionFooter>
      <Button
        className="mt-3"
        disabled={isBusy}
        fullWidth
        onClick={() => {
          switchAccountMutation.mutate();
        }}
        type="button"
        variant="ghost"
      >
        Use another account
      </Button>
    </AuthLayout>
  );
};
