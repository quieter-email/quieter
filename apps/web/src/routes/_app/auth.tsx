import { LoadingPage } from "@quieter/app/components/loading-page";
import { getSafeAuthReturnTo } from "@quieter/app/lib/return-to";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/auth")({
  validateSearch: zodValidator(
    z.object({
      error: z.string().optional(),
      returnTo: z
        .string()
        .optional()
        .transform((returnTo) => getSafeAuthReturnTo(returnTo)),
    })
  ),
  ssr: "data-only",
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
});
