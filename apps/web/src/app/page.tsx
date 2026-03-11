import { MailboxWorkspace } from "~/components/mailbox-workspace";
import { requireSession } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await requireSession();

  return <MailboxWorkspace user={session.user} />;
}
