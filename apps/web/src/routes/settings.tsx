import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { SettingsScreen } from "~/features/settings/components/settings-screen";
import { SETTINGS_TABS } from "~/features/settings/domain/settings-tab";
import { getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/settings")({
  validateSearch: zodValidator(
    z.object({
      from: z
        .string()
        .trim()
        .transform((value) =>
          value && value.startsWith("/") && !value.startsWith("//") ? value : "/",
        )
        .catch("/")
        .default("/"),
      tab: z.string().trim().pipe(z.enum(SETTINGS_TABS)).catch("general").default("general"),
    }),
  ),
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
