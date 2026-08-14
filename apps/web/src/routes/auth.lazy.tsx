import { createLazyFileRoute } from "@tanstack/react-router";

import { AuthRouteComponent } from "#/components/auth-route-component";

export const Route = createLazyFileRoute("/auth")({
  component: AuthRouteComponent,
});
