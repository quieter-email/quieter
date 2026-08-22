import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { OnboardingScreen } from "#/features/onboarding/components/onboarding-screen";
import { getSessionUser } from "#/lib/auth.functions";
import { getSafeAuthReturnTo } from "#/lib/return-to";

// react-doctor-disable-next-line react-doctor/tanstack-start-route-property-order -- The repository's TanStack Router lint rule owns this generated route property order.
export const Route = createFileRoute("/onboarding")({
  component: OnboardingScreen,
  head: () => ({
    meta: [{ title: "Welcome to Quieter" }],
  }),
  loader: async ({ location }) => {
    const user = await getSessionUser();

    if (!user) {
      throw redirect({
        search: { returnTo: location.href },
        to: "/auth",
      });
    }

    // Finished users never see this again; the app routes are the destination.
    if (!user.needsOnboarding) {
      const search = location.search as { returnTo?: string };

      throw redirect({
        href: getSafeAuthReturnTo(search.returnTo) ?? "/",
      });
    }

    return { user };
  },
  pendingComponent: LoadingPage,
  ssr: "data-only",
  validateSearch: zodValidator(
    z.object({
      gmailLink: z
        .union([z.literal("complete"), z.literal("start")])
        .optional(),
      returnTo: z
        .string()
        .optional()
        .transform((returnTo) => getSafeAuthReturnTo(returnTo)),
    })
  ),
});
