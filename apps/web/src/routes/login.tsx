import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { AuthScreen } from "~/components/auth-screen";
import { LoadingPage } from "~/components/loading-page";
import { getSessionUser } from "~/lib/auth.functions";
import { authSearchSchema, toMailboxSearch } from "~/lib/search-params";

export const Route = createFileRoute("/login")({
  validateSearch: zodValidator(authSearchSchema),
  ssr: "data-only",
  loader: async () => {
    const user = await getSessionUser();

    if (user) {
      throw redirect({
        search: toMailboxSearch({}),
        to: "/",
      });
    }
  },
  pendingComponent: LoadingPage,
  component: LoginRouteComponent,
});

function LoginRouteComponent() {
  const { error } = Route.useSearch();

  return <AuthScreen authErrorCode={error} mode="login" />;
}
