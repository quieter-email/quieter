import { SettingsRouteComponent } from "@quieter/app/features/settings/components/settings-route-component";
import { createLazyFileRoute } from "@tanstack/react-router";

export const Route = createLazyFileRoute("/_app/settings")({
  component: SettingsRouteComponent,
});
