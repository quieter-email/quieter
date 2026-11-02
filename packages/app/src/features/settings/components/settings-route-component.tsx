import { SettingsScreen } from "@quieter/app/features/settings/components/settings-screen";
import { getRouteApi } from "@tanstack/react-router";

const settingsRoute = getRouteApi("/_app/settings");

export const SettingsRouteComponent = () => {
  const { user } = settingsRoute.useLoaderData();

  return <SettingsScreen initialUser={user} />;
};
