import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { OnboardingScreen } from "#/features/onboarding/components/onboarding-screen";
import { getSessionUser } from "#/lib/auth.functions";
import { getSafeAuthReturnTo } from "#/lib/return-to";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingScreen,
  validateSearch: zodValidator(
    z.object({
      gmailLink: z
        .union([z.literal("complete"), z.literal("start")])
        .optional(),
      // Flow state lives in the URL so a round trip through Google or a
      // reload resumes where the person left off.
      intents: z.string().optional(),
      returnTo: z
        .string()
        .optional()
        .transform((returnTo) => getSafeAuthReturnTo(returnTo)),
      step: z.coerce.number().int().min(1).max(2).optional(),
    })
  ),
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
