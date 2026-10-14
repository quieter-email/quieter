import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SiteFooter } from "#/components/site-footer";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <>
      <Outlet />
      <SiteFooter />
    </>
  );
}
