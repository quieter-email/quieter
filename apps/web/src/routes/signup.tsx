import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthScreen } from "~/components/auth-screen";
import { LoadingPage } from "~/components/loading-page";
import { getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/signup")({
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
  component: SignupRouteComponent,
});

function SignupRouteComponent() {
  return <AuthScreen mode="signup" />;
}
