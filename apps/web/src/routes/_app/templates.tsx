import { LoadingPage } from "@quieter/app/components/loading-page";
import { BroadcastWorkspace } from "@quieter/app/features/broadcasts/components/broadcast-workspace";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/templates")({
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
  ssr: "data-only",
  component: TemplatesLayout,
  loader: async ({ location }) => {
    const user = await getSessionUser();
    if (!user) {
      throw redirect({ search: { returnTo: location.href }, to: "/auth" });
    }
    if (user.needsOnboarding) {
      throw redirect({
        search: { returnTo: location.href },
        to: "/onboarding",
      });
    }
    return { user };
  },
  pendingComponent: LoadingPage,
});

function TemplatesLayout() {
  return (
    <BroadcastWorkspace
      organizationId={Route.useSearch().organizationId}
      section="templates"
    >
      <Outlet />
    </BroadcastWorkspace>
  );
}
