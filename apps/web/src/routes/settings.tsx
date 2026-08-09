import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { SettingsLoadingPage } from "#/features/settings/components/settings-loading-page";
import { ORGANIZATION_SETTINGS_VIEWS } from "#/features/settings/domain/organization-settings-view";
import { SETTINGS_TABS } from "#/features/settings/domain/settings-tab";
import { getSessionUser } from "#/lib/auth.functions";

const SettingsPendingPage = () => {
  const { tab } = Route.useSearch();
  return <SettingsLoadingPage tab={tab} />;
};

export const Route = createFileRoute("/settings")({
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
  pendingComponent: SettingsPendingPage,
  ssr: "data-only",
  validateSearch: zodValidator(
    z.object({
      billing: z.enum(["canceled", "success"]).optional(),
      checkoutId: z.uuid().optional(),
      connector: z.enum(["connected", "error"]).optional(),
      domainConnect: z
        .enum(["canceled", "error", "needs_dns", "verified"])
        .optional(),
      domainId: z.string().trim().catch("").default(""),
      from: z
        .string()
        .trim()
        .transform((value) =>
          value && value.startsWith("/") && !value.startsWith("//")
            ? value
            : "/"
        )
        .catch("/")
        .default("/"),
      gmail: z.enum(["connected", "error"]).optional(),
      mailboxId: z.string().trim().catch("").default(""),
      organizationId: z.string().trim().catch("").default(""),
      organizationView: z
        .string()
        .trim()
        .pipe(z.enum(ORGANIZATION_SETTINGS_VIEWS))
        .catch("overview")
        .default("overview"),
      tab: z
        .string()
        .trim()
        .pipe(z.enum(SETTINGS_TABS))
        .catch("overview")
        .default("overview"),
    })
  ),
});
