import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { GoogleScopeRepairRouteComponent } from "~/components/google-scope-repair-route-component";
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
