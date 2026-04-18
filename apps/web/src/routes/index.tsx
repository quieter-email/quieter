import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { InboxPageClient } from "~/components/inbox-page-client";
import { LoadingPage } from "~/components/loading-page";
import { getGoogleScopeRepairTarget, getSessionUser } from "~/lib/auth.functions";
import { getGoogleScopeRepairPageHref } from "~/lib/google-scope-repair";
import { mailboxSearchDefaults, mailboxSearchSchema } from "~/lib/search-params";

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(mailboxSearchSchema),
  loaderDeps: ({ search }) => ({
    preferredMailboxId: search.mailboxId,
  }),
  search: {
    middlewares: [stripSearchParams(mailboxSearchDefaults)],
  },
  ssr: "data-only",
  loader: async ({ deps }) => {
    const repairTarget = await getGoogleScopeRepairTarget({
      data: {
        preferredMailboxId: deps.preferredMailboxId,
      },
    });

    if (repairTarget) {
      throw redirect({
        to: getGoogleScopeRepairPageHref({
          targetAccountId: repairTarget.providerAccountId,
        }),
      });
    }

    const user = await getSessionUser();

    if (!user) {
      throw redirect({
        to: "/home",
      });
    }

    return {
      user,
    };
  },
  pendingComponent: LoadingPage,
  component: InboxRouteComponent,
});

function InboxRouteComponent() {
  const { user } = Route.useLoaderData();

  return <InboxPageClient user={user} />;
}
