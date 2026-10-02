import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/device")({
  validateSearch: zodValidator(
    z.object({
      user_code: z.string().trim().min(1).max(32).optional(),
    })
  ),
  ssr: "data-only",
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
});
