import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { getSessionUser } from "#/lib/auth.functions";
import { getSafeAuthReturnTo } from "#/lib/return-to";

// react-doctor-disable-next-line react-doctor/tanstack-start-route-property-order -- The repository's TanStack Router lint rule owns this generated route property order.
export const Route = createFileRoute("/auth")({
  loader: async ({ location }) => {
    const user = await getSessionUser();

    if (user) {
      const search = location.search as { returnTo?: string };

      throw redirect({
        href: getSafeAuthReturnTo(search.returnTo) ?? "/",
      });
    }
  },
  pendingComponent: LoadingPage,
  ssr: "data-only",
  validateSearch: zodValidator(
    z.object({
      error: z.string().optional(),
      returnTo: z
        .string()
        .optional()
        .transform((returnTo) => getSafeAuthReturnTo(returnTo)),
    })
  ),
});
