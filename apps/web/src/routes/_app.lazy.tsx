import { createLazyFileRoute, Outlet } from "@tanstack/react-router";

import { AppProviders } from "#/components/app-providers";

export const Route = createLazyFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}
