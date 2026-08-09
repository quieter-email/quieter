import { createLazyFileRoute } from "@tanstack/react-router";

import { SettingsRouteComponent } from "#/features/settings/components/settings-route-component";

export const Route = createLazyFileRoute("/settings")({
  component: SettingsRouteComponent,
});
