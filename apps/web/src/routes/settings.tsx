import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { SettingsRouteComponent } from "~/features/settings/components/settings-route-component";
import { ORGANIZATION_SETTINGS_VIEWS } from "~/features/settings/domain/organization-settings-view";
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
      billing: z.enum(["canceled", "success"]).optional().catch(undefined),
      checkoutId: z.uuid().optional().catch(undefined),
      connector: z.enum(["connected", "error"]).optional().catch(undefined),
      gmail: z.enum(["connected", "error"]).optional().catch(undefined),
      tab: z.string().trim().pipe(z.enum(SETTINGS_TABS)).catch("overview").default("overview"),
      organizationId: z.string().trim().catch("").default(""),
      organizationView: z
        .string()
        .trim()
        .pipe(z.enum(ORGANIZATION_SETTINGS_VIEWS))
        .catch("overview")
        .default("overview"),
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
