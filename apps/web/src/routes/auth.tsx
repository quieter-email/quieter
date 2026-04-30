import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AuthScreen } from "~/components/auth-screen";
import { LoadingPage } from "~/components/loading-page";
import { getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: zodValidator(
    z.object({
      mode: z.enum(["login", "signup"]).catch("login").default("login"),
    }),
  ),
  ssr: "data-only",
  loader: async () => {
    const user = await getSessionUser();

    if (user) {
      throw redirect({
        to: "/",
      });
    }
  },
  pendingComponent: LoadingPage,
  component: AuthRouteComponent,
});

/**
 * Render the authentication route UI.
 *
 * @returns A React element that renders the authentication screen (`AuthScreen`).
 */
function AuthRouteComponent() {
  return <AuthScreen />;
}
