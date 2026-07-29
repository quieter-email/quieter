import { createLazyFileRoute } from "@tanstack/react-router";
import { SitePasswordRoute } from "~/components/site-password-route";

export const Route = createLazyFileRoute("/site-password")({
  component: SitePasswordRoute,
});
