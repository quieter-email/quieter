import { InboxPageClient } from "@quieter/app/features/mailbox/components/inbox-page-client";
import { createLazyFileRoute } from "@tanstack/react-router";

export const Route = createLazyFileRoute("/_app/")({
  component: InboxRouteComponent,
});

function InboxRouteComponent() {
  const loaderData = Route.useLoaderData();
  if (!("user" in loaderData)) {
    return null;
  }

  return <InboxPageClient user={loaderData.user} />;
}
