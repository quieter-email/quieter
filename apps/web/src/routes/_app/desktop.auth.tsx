import { LoadingPage } from "@quieter/app/components/loading-page";
import { desktopAuthQuerySchema } from "@quieter/auth/desktop";
import { createFileRoute } from "@tanstack/react-router";

import { DesktopAuthScreen } from "#/components/desktop-auth-screen";
import { getSessionUser } from "#/lib/auth.functions";

export const Route = createFileRoute("/_app/desktop/auth")({
  validateSearch: (search) => ({
    desktopAuth: desktopAuthQuerySchema.safeParse(search).data ?? null,
  }),
  ssr: "data-only",
  loader: async () => ({ user: await getSessionUser() }),
  head: () => ({
    meta: [
      { title: "Sign in to quieter desktop" },
      { content: "noindex, nofollow", name: "robots" },
      { content: "no-referrer", name: "referrer" },
    ],
  }),
  headers: () => ({ "Cache-Control": "no-store" }),
  pendingComponent: LoadingPage,
  component: DesktopAuthScreen,
});
