import { getRouteApi } from "@tanstack/react-router";

import { SettingsScreen } from "./settings-screen";

const settingsRoute = getRouteApi("/_app/settings");

export const SettingsRouteComponent = () => {
  const { user } = settingsRoute.useLoaderData();

  return <SettingsScreen initialUser={user} />;
};
