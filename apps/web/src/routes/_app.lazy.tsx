import { AppProviders } from "@quieter/app/components/app-providers";
import { extractRouteSessionUser } from "@quieter/app/session-user";
import {
  createLazyFileRoute,
  Outlet,
  useMatches,
} from "@tanstack/react-router";

export const Route = createLazyFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const initialUser = useMatches({
    select: extractRouteSessionUser,
  });

  return (
    <AppProviders initialUser={initialUser}>
      <Outlet />
    </AppProviders>
  );
}
