import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { SettingsScreen } from "~/features/settings/components/settings-screen";
import { SETTINGS_TABS, type SettingsTab } from "~/features/settings/domain/settings-tab";
import { getSessionUser } from "~/lib/auth.functions";

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
};

const normalizeRelativePath = (value: string | null | undefined) => {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !normalizedValue.startsWith("/") || normalizedValue.startsWith("//")) {
    return "/";
  }

  return normalizedValue;
};

const settingsSearchDefaults = {
  from: "/",
  tab: "general",
} as const satisfies { from: string; tab: SettingsTab };

const settingsTabSet = new Set<string>(SETTINGS_TABS);

const settingsSearchSchema = z
  .object({
    from: z.preprocess(
      (value) => (typeof value === "string" ? value : undefined),
      z.string().optional(),
    ),
    tab: z.preprocess(
      (value) => (typeof value === "string" ? value : undefined),
      z.string().optional(),
    ),
  })
  .transform((search) => {
    const normalizedTab = normalizeOptionalString(search.tab);

    return {
      from: normalizeRelativePath(search.from ?? settingsSearchDefaults.from),
      tab:
        normalizedTab && settingsTabSet.has(normalizedTab)
          ? (normalizedTab as SettingsTab)
          : settingsSearchDefaults.tab,
    };
  });

export const Route = createFileRoute("/settings")({
  validateSearch: zodValidator(settingsSearchSchema),
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
