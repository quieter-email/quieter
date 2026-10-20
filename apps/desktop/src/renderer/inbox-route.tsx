import { InboxPageClient } from "@quieter/app/features/mailbox/components/inbox-page-client";
import { getRouteApi } from "@tanstack/react-router";

const inboxRoute = getRouteApi("/_app/");

export const DesktopInboxRoute = () => {
  const { user } = inboxRoute.useLoaderData();
  return <InboxPageClient user={user} />;
};
