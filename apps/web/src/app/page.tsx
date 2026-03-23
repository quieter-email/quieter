import type { SearchParams } from "nuqs/server";
import { redirect } from "next/navigation";
import { InboxPageClient } from "~/components/inbox-page-client";
import { getGoogleScopeRepairPageHref } from "~/lib/google-scope-repair";
import { getGoogleScopeRepairTarget, requireSession } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

type InboxPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = await searchParams;
  const preferredMailboxId = Array.isArray(params.mailboxId)
    ? params.mailboxId[0]
    : (params.mailboxId ?? null);
  const repairTarget = await getGoogleScopeRepairTarget({
    preferredMailboxId,
  });

  if (repairTarget) {
    redirect(getGoogleScopeRepairPageHref({ targetAccountId: repairTarget.providerAccountId }));
  }

  const session = await requireSession();

  return <InboxPageClient user={session.user} />;
}
