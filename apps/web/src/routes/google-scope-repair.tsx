import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getGoogleScopeRepairTarget, getSessionUser } from "~/lib/auth.functions";
import {
  getGoogleScopeRepairPageHref,
  getGoogleScopeRepairReturnTo,
  getGoogleScopeRepairStartHref,
} from "~/lib/google-scope-repair";

const googleScopeRepairSearchSchema = z.object({
  from: z
    .preprocess((value) => (typeof value === "string" ? value : undefined), z.string().optional())
    .transform((value) => getGoogleScopeRepairReturnTo(value ?? "/")),
  returned: z.preprocess((value) => value === "1", z.boolean()),
  targetAccountId: z
    .preprocess((value) => (typeof value === "string" ? value : undefined), z.string().optional())
    .transform((value) => {
      const normalizedValue = value?.trim();
      return normalizedValue ? normalizedValue : null;
    }),
});

const googleScopeRepairSearchDefaults = {
  from: "/",
  returned: false,
} as const;

export const Route = createFileRoute("/google-scope-repair")({
  validateSearch: zodValidator(googleScopeRepairSearchSchema),
  search: {
    middlewares: [stripSearchParams(googleScopeRepairSearchDefaults)],
  },
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
      throw redirect({
        href: getGoogleScopeRepairPageHref({
          from: deps.from,
          targetAccountId: repairTarget.providerAccountId,
        }),
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
          {returned ? (
            <p className="text-sm text-muted-foreground">
              If Google shows multiple accounts, choose {repairTarget.emailAddress}. Quieter will
              keep asking until this mailbox has the required permissions.
            </p>
          ) : null}
        </div>

        <div className="pt-1">
          <a
            className="inline-flex h-9 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            href={getGoogleScopeRepairStartHref({
              from: returnTo,
              targetAccountId: repairTarget.providerAccountId,
            })}
          >
            Continue to Google
          </a>
        </div>
      </div>
    </div>
  );
}
