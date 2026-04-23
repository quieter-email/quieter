import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { LoadingPage } from "~/components/loading-page";
import { InboxPageClient } from "~/features/mailbox/components/inbox-page-client";
import { getSessionUser } from "~/lib/auth.functions";
import { mailboxSearchDefaults, mailboxSearchSchema } from "~/lib/search-params";

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(mailboxSearchSchema),
  search: {
    middlewares: [stripSearchParams(mailboxSearchDefaults)],
  },
  ssr: "data-only",
  loader: async () => {
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
