import { LoadingPage } from "@quieter/app/components/loading-page";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/")({
  validateSearch: zodValidator(mailboxSearchSchema),
  ssr: "data-only",
  loader: async ({ location }) => {
    const user = await getSessionUser();

    if (!user) {
      return redirect({
        search: {
          returnTo: location.href,
        },
        to: "/auth",
      });
    }

    if (user.needsOnboarding) {
      return redirect({
        search: { returnTo: location.href },
        to: "/onboarding",
      });
    }

    return {
      user,
    };
  },
  pendingComponent: LoadingPage,
});

export type MailboxSearch = ReturnType<typeof Route.useSearch>;
