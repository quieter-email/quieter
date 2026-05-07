import { REQUIRED_GOOGLE_SCOPES } from "@quieter/auth/google-scopes";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "~/lib/auth";
import { getGoogleScopeRepairTarget, getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/google-scope-repair")({
  validateSearch: zodValidator(
    z.object({
      from: z
        .string()
        .trim()
        .transform((value) =>
          value && value.startsWith("/") && !value.startsWith("//") ? value : "/",
        )
        .catch("/")
        .default("/"),
      returned: z.preprocess((value) => value === "1", z.boolean()),
      targetAccountId: z
        .string()
        .trim()
        .transform((value) => value || null)
        .catch(null),
    }),
  ),
  loaderDeps: ({ search }) => ({
    from: search.from,
    targetAccountId: search.targetAccountId,
  }),
  loader: async ({ deps }) => {
    const [user, repairTarget] = await Promise.all([
      getSessionUser(),
      getGoogleScopeRepairTarget({
        data: {
          targetAccountId: deps.targetAccountId,
        },
      }),
    ]);

    if (!user) {
      throw redirect({
        to: "/home",
      });
    }

    if (!repairTarget) {
      throw redirect({
        to: deps.from,
      });
    }

    if (deps.targetAccountId !== repairTarget.providerAccountId) {
      const hrefParams = new URLSearchParams({
        targetAccountId: repairTarget.providerAccountId,
      });
      if (deps.from !== "/") {
        hrefParams.set("from", deps.from);
      }
      throw redirect({
        href: `/google-scope-repair?${hrefParams.toString()}`,
      });
    }

    return {
      repairTarget,
      returnTo: deps.from,
    };
  },
  component: GoogleScopeRepairRouteComponent,
});

function GoogleScopeRepairRouteComponent() {
  const { returned } = Route.useSearch();
  const { repairTarget, returnTo } = Route.useLoaderData();
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
            {isStartingRepair ? "Opening Google..." : "Continue to Google"}
          </button>
          {repairError && (
            <div
              aria-live="polite"
              className="mt-3 text-sm text-destructive"
              role="status"
              tabIndex={-1}
            >
              {repairError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
