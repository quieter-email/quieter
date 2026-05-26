import { createFileRoute } from "@tanstack/react-router";
import { SitePasswordRouteComponent } from "~/components/site-password-route-component";

export const Route = createFileRoute("/site-password")({
  component: SitePasswordRouteComponent,
});
