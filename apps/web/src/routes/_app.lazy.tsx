import { AppProviders } from "@quieter/app/components/app-providers";
import { createLazyFileRoute, Outlet } from "@tanstack/react-router";

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
