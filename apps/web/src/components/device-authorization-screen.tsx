"use client";

import { Button } from "@quieter/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { AuthVisual } from "#/components/auth-visual";
import { authClient } from "#/lib/auth";
import { toastError } from "#/lib/error-toast";

const deviceRouteApi = getRouteApi("/device");

type Decision = "approved" | "denied";

export const DeviceAuthorizationScreen = () => {
  const { user_code: userCode } = deviceRouteApi.useSearch();
  const verification = useQuery({
    enabled: userCode !== undefined,
    queryFn: async () => {
      if (userCode === undefined) {
        throw new Error("This device code is missing.");
      }
      const response = await authClient.device({
        query: { user_code: userCode },
      });
      if (response.error) {
        throw new Error(
          response.error?.status && response.error.status < 500
            ? (response.error.error_description ??
                "This code is invalid or expired.")
            : "This request could not be verified. Try again."
        );
      }
      if (response.data.client_id !== "quieter-desktop") {
        throw new Error("This request is unavailable for this account.");
      }
      if (response.data.status !== "pending") {
        throw new Error("This request has already been completed.");
      }
      return response.data;
    },
    queryKey: ["auth", "device", "verify", userCode],
    refetchOnWindowFocus: false,
    retry: false,
  });
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Device authorization only changes the local approval result, not cached browser data.
  const authorization = useMutation({
    mutationFn: async (decision: Decision) => {
      if (userCode === undefined || verification.data === undefined) {
        throw new Error("Verify this device request before deciding.");
      }
      const response = await (decision === "approved"
        ? authClient.device.approve({ userCode })
        : authClient.device.deny({ userCode }));
      if (response.error) {
        throw Object.assign(
          new Error(
            response.error.error_description ??
              "This authorization request could not be completed."
          ),
          { status: response.error.status }
        );
      }
      return { decision, userCode };
    },
    mutationKey: ["auth", "device", "decision", userCode],
    onError: (error) => {
      toastError(error, { boundary: "device-authorization" });
    },
  });

  const decision =
    authorization.data !== undefined && authorization.data.userCode === userCode
      ? authorization.data.decision
      : null;
  const error = authorization.error ?? verification.error;
  const pending = authorization.isPending || verification.isFetching;
  const canDecide = verification.data !== undefined && !pending;

  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden md:grid-cols-2">
      <main className="flex size-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-md">
          {decision === null ? (
            <>
              <p className="text-caption font-medium text-muted-fg">
                Quieter desktop
              </p>
              <h1 className="mt-3 text-title-md font-medium tracking-tight text-fg">
                Authorize this device
              </h1>
              <p className="mt-2 text-body text-muted-fg">
                Confirm that this code matches the one shown in the desktop app.
                This signs the desktop app into your Quieter account, including
                access to read, send, and manage mail.
              </p>

              <div className="mt-8 rounded-xl border border-border bg-bg-raised px-5 py-6 text-center shadow-sm">
                <span className="text-micro font-medium tracking-wide text-muted-fg uppercase">
                  Device code
                </span>
                <p className="mt-2 font-mono text-title-lg font-semibold tracking-widest text-fg">
                  {userCode ?? "Code missing"}
                </p>
              </div>

              {userCode === undefined ? (
                <p className="mt-4 text-body text-destructive">
                  Open this page from Quieter desktop to get a valid code.
                </p>
              ) : null}
              {verification.isFetching ? (
                <p className="mt-4 text-body text-muted-fg">
                  Checking this request…
                </p>
              ) : null}
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
                  disabled={!canDecide}
                  onClick={() => {
                    authorization.mutate("approved");
                  }}
                  type="button"
                >
                  {pending ? "Working…" : "Authorize"}
                </Button>
                <Button
                  className="flex-1 justify-center"
                  disabled={!canDecide}
                  onClick={() => {
                    authorization.mutate("denied");
                  }}
                  type="button"
                  variant="outline"
                >
                  {pending ? "Working…" : "Decline"}
                </Button>
              </div>
              <p className="mt-5 text-caption text-muted-fg">
                Only authorize a device you control. The request expires after
                five minutes.
              </p>
            </>
          ) : (
            <>
              <p className="text-caption font-medium text-muted-fg">
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
