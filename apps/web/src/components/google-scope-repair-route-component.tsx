import { REQUIRED_GOOGLE_SCOPES } from "@quieter/auth/google-scopes";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "~/lib/auth";

const googleScopeRepairRoute = getRouteApi("/google-scope-repair");

export const GoogleScopeRepairRouteComponent = () => {
  const { returned } = googleScopeRepairRoute.useSearch();
  const { repairTarget, returnTo } = googleScopeRepairRoute.useLoaderData();
  const callbackParams = new URLSearchParams({
    targetAccountId: repairTarget.providerAccountId,
  });
  if (returnTo !== "/") {
    callbackParams.set("from", returnTo);
  }
  callbackParams.set("returned", "1");
  const callbackURL = `/google-scope-repair?${callbackParams.toString()}`;
  const [repairError, setRepairError] = useState<string | null>(null);
  const [isStartingRepair, setIsStartingRepair] = useState(false);
  const startRepair = async () => {
    setIsStartingRepair(true);
    setRepairError(null);

    try {
      const response = await authClient.linkSocial({
        callbackURL,
        disableRedirect: true,
        errorCallbackURL: callbackURL,
        provider: "google",
        scopes: [...REQUIRED_GOOGLE_SCOPES],
      });

      if (response.error) {
        setRepairError(response.error.message ?? "Could not start Google reconnect.");
        setIsStartingRepair(false);
        return;
      }

      if (!response.data?.url) {
        setRepairError("Could not start Google reconnect.");
        setIsStartingRepair(false);
        return;
      }

      const providerUrl = new URL(response.data.url);
      providerUrl.searchParams.set("login_hint", repairTarget.emailAddress);
      providerUrl.searchParams.set("prompt", "consent select_account");
      window.location.assign(providerUrl.toString());
    } catch (error) {
      setRepairError(
        error instanceof Error && error.message
          ? error.message
          : "Could not start Google reconnect.",
      );
      setIsStartingRepair(false);
    }
  };
  const repairDescription =
    repairTarget.repairReason === "missing_scopes"
      ? `Quieter needs Google permissions for ${repairTarget.emailAddress}.`
      : `Quieter needs you to reconnect Google for ${repairTarget.emailAddress}.`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-6 py-20">
      <div className="w-full max-w-xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-medium tracking-tight text-foreground">
            Reconnect {repairTarget.emailAddress}
          </h1>
          <p className="text-sm text-muted-foreground">{repairDescription}</p>
          {returned && (
            <p className="text-sm text-muted-foreground">
              If Google shows multiple accounts, choose {repairTarget.emailAddress}. Quieter will
              keep asking until this mailbox has the required permissions.
            </p>
          )}
        </div>

        <div className="pt-1">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            disabled={isStartingRepair}
            onClick={() => {
              void startRepair();
            }}
            type="button"
          >
            {isStartingRepair ? "Opening Google…" : "Continue to Google"}
          </button>
          {repairError && (
            <output aria-live="polite" className="mt-3 block text-sm text-destructive">
              {repairError}
            </output>
          )}
        </div>
      </div>
    </div>
  );
};
