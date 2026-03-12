import { InboxPageClient } from "~/components/inbox-page-client";
import { requireSession } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await requireSession();

  return <InboxPageClient user={session.user} />;
}
