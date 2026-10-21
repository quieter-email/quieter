import { LoadingPage } from "@quieter/app/components/loading-page";
import { OnboardingScreen } from "@quieter/app/features/onboarding/components/onboarding-screen";
import { getSafeAuthReturnTo } from "@quieter/app/lib/return-to";
import { onboardingSearchSchema } from "@quieter/app/route-search";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/onboarding")({
  component: OnboardingScreen,
  validateSearch: zodValidator(onboardingSearchSchema),
  ssr: "data-only",
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
  head: () => ({
    meta: [{ title: "Welcome to Quieter" }],
  }),
  pendingComponent: LoadingPage,
});
