import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionUser } from "~/lib/auth.functions";
export const Route = createFileRoute("/auth")({
  loader: async () => {
    const user = await getSessionUser();

    if (user) {
      throw redirect({
        to: "/",
      });
    }

    throw redirect({
      to: "/login",
    });
  },
});
