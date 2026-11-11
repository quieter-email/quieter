import { LoadingPage } from "@quieter/app/components/loading-page";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { getOperationsAccess } from "#/lib/operations.functions";

export const Route = createFileRoute("/_app/operations")({
  ssr: "data-only",
  loader: async ({ location }) => {
    const access = await getOperationsAccess();

    if (access === "signed-out") {
      throw redirect({ search: { returnTo: location.href }, to: "/auth" });
    }

    if (access === "onboarding") {
      throw redirect({
        search: { returnTo: location.href },
        to: "/onboarding",
      });
    }

    if (access !== "allowed") {
      throw notFound();
    }
  },
  head: () => ({
    meta: [
      { title: "Operations | quieter" },
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
  pendingComponent: LoadingPage,
});
