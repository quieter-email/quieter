import { createLazyFileRoute } from "@tanstack/react-router";
import { InboxPageClient } from "~/features/mailbox/components/inbox-page-client";

export const Route = createLazyFileRoute("/")({
  component: InboxRouteComponent,
});

function InboxRouteComponent() {
  const { user } = Route.useLoaderData();

  return <InboxPageClient user={user} />;
}
