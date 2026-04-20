import { Link, createFileRoute, redirect } from "@tanstack/react-router";
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

export const Route = createFileRoute("/google-scope-repair")({
  validateSearch: zodValidator(googleScopeRepairSearchSchema),
  loaderDeps: ({ search }) => ({
    from: search.from,
    targetAccountId: search.targetAccountId,
  }),
  loader: async ({ deps }) => {
    const user = await getSessionUser();

    if (!user) {
      throw redirect({
        to: "/home",
      });
    }

    const repairTarget = await getGoogleScopeRepairTarget({
      data: {
        targetAccountId: deps.targetAccountId,
      },
    });

    if (!repairTarget) {
      throw redirect({
        to: deps.from,
      });
    }

    if (deps.targetAccountId !== repairTarget.providerAccountId) {
      throw redirect({
        to: getGoogleScopeRepairPageHref({
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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-6 py-20">
      <div className="w-full max-w-xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-medium tracking-tight text-foreground">
            Reconnect {repairTarget.emailAddress}
          </h1>
          <p className="text-sm text-muted-foreground">
            Quietr needs Google permissions for {repairTarget.emailAddress}.
          </p>
          {returned ? (
            <p className="text-sm text-muted-foreground">
              If Google shows multiple accounts, choose {repairTarget.emailAddress}. Quietr will
              keep asking until this mailbox has the required permissions.
            </p>
          ) : null}
        </div>

        <div className="pt-1">
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            to={getGoogleScopeRepairStartHref({
              from: returnTo,
              targetAccountId: repairTarget.providerAccountId,
            })}
          >
            Continue to Google
          </Link>
        </div>
      </div>
    </div>
  );
}
