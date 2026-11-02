import { LoadingPage } from "@quieter/app/components/loading-page";
import { BroadcastWorkspace } from "@quieter/app/features/broadcasts/components/broadcast-workspace";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/audiences")({
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
  ssr: "data-only",
  component: AudiencesLayout,
  loader: async ({ location }) => {
    const user = await getSessionUser();
    if (!user) {
      throw redirect({ to: "/auth", search: { returnTo: location.href } });
    }
    if (user.needsOnboarding) {
      throw redirect({
        to: "/onboarding",
        search: { returnTo: location.href },
      });
    }
    return { user };
  },
  pendingComponent: LoadingPage,
});

function AudiencesLayout() {
  return (
    <BroadcastWorkspace
      organizationId={Route.useSearch().organizationId}
      section="audiences"
    >
      <Outlet />
    </BroadcastWorkspace>
  );
}
