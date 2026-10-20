"use client";

import { AuthLayout } from "@quieter/app/components/auth-layout";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  DESKTOP_AUTH_BROWSER_PATH,
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_PROTOCOL_SCHEME,
} from "@quieter/auth/desktop";
import { Button } from "@quieter/ui/button";
import { FieldLabel } from "@quieter/ui/field";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { useMutation } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthCredentials } from "#/components/auth-screen";

const routeApi = getRouteApi("/_app/desktop/auth");

export const DesktopAuthScreen = () => {
  const { desktopAuth } = routeApi.useSearch();
  const { user } = routeApi.useLoaderData();
  const [authorizationCode, setAuthorizationCode] = useState(() => {
    const code = authClient.electron.getAuthorizationCode();
    if (desktopAuth === null || !code) {
      return null;
    }
    try {
      const payload: unknown = JSON.parse(
        atob(code.replaceAll("-", "+").replaceAll("_", "/"))
      );
      return typeof payload === "object" &&
        payload !== null &&
        "state" in payload &&
        payload.state === desktopAuth.state
        ? code
        : null;
    } catch {
      return null;
    }
  });
  const [copied, setCopied] = useState(false);
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Transferring a browser session only updates the local handoff code.
  const transferMutation = useMutation({
    mutationFn: async () => {
      if (desktopAuth === null) {
        throw new Error("Open sign-in from the desktop app to continue.");
      }
      const response = await authClient.electron.transferUser({
        fetchOptions: { query: desktopAuth },
      });
      if (response.error) {
        throw new Error(
          response.error.message ??
            "The sign-in handoff could not be completed.",
          { cause: response.error }
        );
      }
      const code = authClient.electron.getAuthorizationCode();
      if (!code) {
        throw new Error("The sign-in handoff could not be completed.");
      }
      return code;
    },
    mutationKey: ["auth", "desktop", "transfer"],
    onError: (error) => {
      toastError(error, { boundary: "desktop-auth-transfer" });
    },
    onSuccess: setAuthorizationCode,
  });

  useEffect(() => {
    const interval =
      desktopAuth === null || authorizationCode === null
        ? undefined
        : authClient.ensureElectronRedirect();
    return () => {
      if (interval !== undefined) {
        clearInterval(interval);
      }
    };
  }, [authorizationCode, desktopAuth]);

  const returnTo =
    desktopAuth === null
      ? DESKTOP_AUTH_BROWSER_PATH
      : `${DESKTOP_AUTH_BROWSER_PATH}?${new URLSearchParams(desktopAuth)}`;

  const handleCopyAuthorizationCode = async () => {
    if (authorizationCode === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(authorizationCode);
      setCopied(true);
    } catch (error) {
      toastError(error, { boundary: "desktop-auth-copy" });
    }
  };

  return (
    <AuthLayout title="Continue to Quieter">
      {desktopAuth === null && (
        <p className="mt-6 text-body/6 text-muted-fg">
          Open the Quieter desktop app and choose Continue in browser to start a
          new sign-in.
        </p>
      )}
      {desktopAuth !== null && authorizationCode !== null && (
        <div className="mt-8 grid gap-6">
          <Button
            onClick={() => {
              window.location.assign(
                `${DESKTOP_AUTH_PROTOCOL_SCHEME}:/${DESKTOP_AUTH_CALLBACK_PATH}#token=${authorizationCode}`
              );
            }}
            size="block"
            type="button"
          >
            Open Quieter
          </Button>
          <TextField>
            <FieldLabel htmlFor="desktop-sign-in-code">
              App did not open? Paste this code in Quieter.
            </FieldLabel>
            <TextFieldInput
              autoComplete="off"
              id="desktop-sign-in-code"
              readOnly
              value={authorizationCode}
            />
          </TextField>
          <Button
            onClick={() => {
              void handleCopyAuthorizationCode();
            }}
            size="block"
            type="button"
            variant="outline"
          >
            {copied ? "Copied" : "Copy sign-in code"}
          </Button>
        </div>
      )}
      {desktopAuth !== null && authorizationCode === null && user !== null && (
        <div className="mt-8 grid gap-3">
          <Button
            disabled={transferMutation.isPending}
            onClick={() => {
              transferMutation.mutate();
            }}
            size="block"
            type="button"
          >
            {transferMutation.isPending
              ? "Opening Quieter…"
              : `Continue as ${user.name || user.email}`}
          </Button>
          <p className="text-caption/5 text-muted-fg">
            Signed in as {user.email}.
          </p>
        </div>
      )}
      {desktopAuth !== null && authorizationCode === null && user === null && (
        <AuthCredentials electronQuery={desktopAuth} returnTo={returnTo} />
      )}
    </AuthLayout>
  );
};
