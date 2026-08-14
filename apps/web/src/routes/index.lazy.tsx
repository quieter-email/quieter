import { createLazyFileRoute } from "@tanstack/react-router";

import { InboxPageClient } from "#/features/mailbox/components/inbox-page-client";

export const Route = createLazyFileRoute("/")({
  component: InboxRouteComponent,
});

function InboxRouteComponent() {
  const loaderData = Route.useLoaderData();
  if (!("user" in loaderData)) {
    return null;
  }

  return <InboxPageClient user={loaderData.user} />;
}
