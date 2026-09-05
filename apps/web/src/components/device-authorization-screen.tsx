"use client";

import { Button } from "@quieter/ui/button";
import { useMutation } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { AuthVisual } from "#/components/auth-visual";
import { authClient } from "#/lib/auth";

const deviceRouteApi = getRouteApi("/device");

type Decision = "approved" | "denied" | null;

export const DeviceAuthorizationScreen = () => {
  const { user_code: userCode } = deviceRouteApi.useSearch();
  const [decision, setDecision] = useState<Decision>(null);

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- Device authorization has no query-backed browser state.
  const approval = useMutation({
    mutationFn: async () => {
      if (!userCode) {
        throw new Error("This device code is missing.");
      }
      const response = await authClient.device.approve({ userCode });
      if (response.error) {
        throw new Error(
          response.error.error_description ??
            "This device could not be authorized."
        );
      }
    },
    mutationKey: ["auth", "device", "approve", userCode],
    onSuccess: () => setDecision("approved"),
  });
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- Device authorization has no query-backed browser state.
  const denial = useMutation({
    mutationFn: async () => {
      if (!userCode) {
        throw new Error("This device code is missing.");
      }
      const response = await authClient.device.deny({ userCode });
      if (response.error) {
        throw new Error(
          response.error.error_description ??
            "This request could not be declined."
        );
      }
    },
    mutationKey: ["auth", "device", "deny", userCode],
    onSuccess: () => setDecision("denied"),
  });

  const error = approval.error ?? denial.error;
  const pending = approval.isPending || denial.isPending;

  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden md:grid-cols-2">
      <main className="flex size-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-md">
          {decision === null ? (
            <>
              <p className="text-label font-medium text-muted-fg">
                Quieter desktop
              </p>
              <h1 className="mt-3 text-title-md font-medium tracking-tight text-fg">
                Authorize this device
              </h1>
              <p className="mt-2 text-body text-muted-fg">
                Confirm that this code matches the one shown in the desktop app.
                The app will be able to read and manage mail for your account.
              </p>

              <div className="mt-8 rounded-xl border border-border bg-bg-raised px-5 py-6 text-center shadow-sm">
                <span className="text-micro font-medium tracking-wide text-muted-fg uppercase">
                  Device code
                </span>
                <p className="mt-2 font-mono text-title-lg font-semibold tracking-[0.24em] text-fg">
                  {userCode ?? "Code missing"}
                </p>
              </div>

              {userCode ? null : (
                <p className="mt-4 text-body text-destructive">
                  Open this page from Quieter desktop to get a valid code.
                </p>
              )}
              {error ? (
                <output
                  aria-live="assertive"
                  className="mt-4 block text-body text-destructive"
                >
                  {error.message}
                </output>
              ) : null}

              <div className="mt-8 flex gap-3">
                <Button
                  className="flex-1 justify-center"
                  disabled={pending || !userCode}
                  onClick={() => approval.mutate()}
                  type="button"
                >
                  {approval.isPending ? "Authorizing…" : "Authorize"}
                </Button>
                <Button
                  className="flex-1 justify-center"
                  disabled={pending || !userCode}
                  onClick={() => denial.mutate()}
                  type="button"
                  variant="outline"
                >
                  {denial.isPending ? "Declining…" : "Decline"}
                </Button>
              </div>
              <p className="mt-5 text-caption text-muted-fg">
                Only authorize a device you control. The code expires shortly.
              </p>
            </>
          ) : (
            <>
              <p className="text-label font-medium text-muted-fg">
                Quieter desktop
              </p>
              <h1 className="mt-3 text-title-md font-medium tracking-tight text-fg">
                {decision === "approved"
                  ? "Device authorized"
                  : "Request declined"}
              </h1>
              <p className="mt-2 text-body text-muted-fg">
                {decision === "approved"
                  ? "Quieter desktop will finish signing in automatically. You can close this window."
                  : "The desktop app was not given access. You can close this window."}
              </p>
            </>
          )}
        </div>
      </main>
      <div className="size-full min-h-0 border-l bg-bg-surface max-md:hidden">
        <AuthVisual />
      </div>
    </div>
  );
};
