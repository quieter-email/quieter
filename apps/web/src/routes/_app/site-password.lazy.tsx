import { createLazyFileRoute } from "@tanstack/react-router";

import { SitePasswordRoute } from "#/components/site-password-route";

export const Route = createLazyFileRoute("/_app/site-password")({
  component: SitePasswordRoute,
});
