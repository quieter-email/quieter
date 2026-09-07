import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { getSessionUser } from "#/lib/auth.functions";

// react-doctor-disable-next-line react-doctor/tanstack-start-route-property-order -- The repository's TanStack Router lint rule owns this generated route property order.
export const Route = createFileRoute("/device")({
  loader: async ({ location }) => {
    const user = await getSessionUser();
    if (!user) {
      throw redirect({
        search: { returnTo: location.href },
        to: "/auth",
      });
    }
  },
  pendingComponent: LoadingPage,
  ssr: "data-only",
  validateSearch: zodValidator(
    z.object({
      user_code: z.string().trim().min(1).max(32).optional(),
    })
  ),
});
