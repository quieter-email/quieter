import { LoadingPage } from "@quieter/app/components/loading-page";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { getSessionUser } from "#/lib/auth.functions";
import { getGmailCallbackError } from "#/lib/gmail-callback-result.functions";

export const Route = createFileRoute("/_app/")({
  validateSearch: zodValidator(mailboxSearchSchema),
  loaderDeps: ({ search }) => ({ gmail: search.gmail }),
  ssr: "data-only",
  loader: async ({ deps, location }) => {
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
      gmailError: deps.gmail === "error" ? await getGmailCallbackError() : null,
      user,
    };
  },
  pendingComponent: LoadingPage,
});

export type MailboxSearch = ReturnType<typeof Route.useSearch>;
