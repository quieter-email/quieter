import type { SearchParams } from "nuqs/server";
import { SettingsScreen } from "~/components/settings-screen";
import { loadSettingsSearchParams } from "~/lib/search-params";
import { requireSession } from "~/lib/server-auth";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await requireSession();
  const { from, tab } = await loadSettingsSearchParams(searchParams);

  return <SettingsScreen from={from} initialTab={tab} initialUser={session.user} />;
}
