import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { LoadingPage } from "~/components/loading-page";
import { SettingsScreen } from "~/components/settings-screen";
import { getSessionUser } from "~/lib/auth.functions";
import { settingsSearchDefaults, settingsSearchSchema } from "~/lib/search-params";

export const Route = createFileRoute("/settings")({
  validateSearch: zodValidator(settingsSearchSchema),
  search: {
    middlewares: [stripSearchParams(settingsSearchDefaults)],
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
  component: SettingsRouteComponent,
});

function SettingsRouteComponent() {
  const { user } = Route.useLoaderData();

  return <SettingsScreen initialUser={user} />;
}
