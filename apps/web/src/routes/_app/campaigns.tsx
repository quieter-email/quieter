import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { BroadcastWorkspace } from "#/features/broadcasts/components/broadcast-workspace";
import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/campaigns")({
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
  ssr: "data-only",
  component: CampaignsLayout,
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

function CampaignsLayout() {
  return (
    <BroadcastWorkspace
      organizationId={Route.useSearch().organizationId}
      section="campaigns"
    >
      <Outlet />
    </BroadcastWorkspace>
  );
}
