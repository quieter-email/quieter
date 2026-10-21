import { SettingsLoadingPage } from "@quieter/app/features/settings/components/settings-loading-page";
import { settingsSearchSchema } from "@quieter/app/route-search";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { getSessionUser } from "#/lib/auth.functions";
import { getGmailCallbackError } from "#/lib/gmail-callback-result.functions";

const SettingsPendingPage = () => {
  const { tab } = Route.useSearch();
  return <SettingsLoadingPage tab={tab} />;
};

export const Route = createFileRoute("/_app/settings")({
  validateSearch: zodValidator(settingsSearchSchema),
  loaderDeps: ({ search }) => ({ gmail: search.gmail }),
  ssr: "data-only",
  loader: async ({ deps }) => {
    const user = await getSessionUser();

    if (!user) {
      throw redirect({
        to: "/home",
      });
    }

    if (user.needsOnboarding) {
      throw redirect({
        search: { returnTo: "/settings" },
        to: "/onboarding",
      });
    }

    return {
      gmailError: deps.gmail === "error" ? await getGmailCallbackError() : null,
      user,
    };
  },
  pendingComponent: SettingsPendingPage,
});
