import { getRouteApi } from "@tanstack/react-router";
import { SitePasswordRouteComponent } from "~/components/site-password-route-component";

const sitePasswordRouteApi = getRouteApi("/site-password");

export const SitePasswordRoute = () => {
  const { sitePasswordError } = sitePasswordRouteApi.useSearch();

  return <SitePasswordRouteComponent hasSitePasswordError={sitePasswordError} />;
};
