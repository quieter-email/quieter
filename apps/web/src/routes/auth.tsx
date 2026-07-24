import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { lazy, Suspense } from "react";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { getSessionUser } from "~/lib/auth.functions";
import { getSafeAuthReturnTo } from "~/lib/return-to";

const AuthRouteComponent = lazy(() =>
  import("~/components/auth-route-component").then(({ AuthRouteComponent: Component }) => ({
    default: Component,
  })),
);

export const Route = createFileRoute("/auth")({
  validateSearch: zodValidator(
    z.object({
      error: z.string().optional(),
      mode: z.enum(["login", "signup"]).catch("login").default("login"),
      returnTo: z
        .string()
        .optional()
        .catch(undefined)
        .transform((returnTo) => getSafeAuthReturnTo(returnTo)),
    }),
  ),
  ssr: "data-only",
  loader: async ({ location }) => {
    const user = await getSessionUser();

    if (user) {
      const search = location.search as { returnTo?: string };

      throw redirect({
        href: getSafeAuthReturnTo(search.returnTo) ?? "/",
      });
    }
  },
  pendingComponent: LoadingPage,
  component: () => (
    <Suspense fallback={<LoadingPage />}>
      <AuthRouteComponent />
    </Suspense>
  ),
});
