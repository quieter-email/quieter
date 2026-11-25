import { LoadingPage } from "@quieter/app/components/loading-page";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { McpConsentScreen } from "#/components/mcp-consent-screen";
import { getMcpConsent } from "#/lib/mcp-oauth.functions";

export const Route = createFileRoute("/_app/oauth/consent")({
  validateSearch: zodValidator(
    z.object({ request: z.string().min(1).max(8192) })
  ),
  loaderDeps: ({ search }) => ({ request: search.request }),
  ssr: "data-only",
  loader: async ({ deps }) => {
    const { consent, user } = await getMcpConsent({ data: deps });
    if (user === null) {
      throw redirect({ search: deps, to: "/oauth/login" });
    }
    if (user.needsOnboarding) {
      throw redirect({
        search: { returnTo: `/oauth/login?${new URLSearchParams(deps)}` },
        to: "/onboarding",
      });
    }
    return { consent, email: user.email, userId: user.id };
  },
  head: () => ({
    meta: [
      { title: "Connect to quieter" },
      { content: "noindex, nofollow", name: "robots" },
      { content: "no-referrer", name: "referrer" },
    ],
  }),
  headers: () => ({ "Cache-Control": "no-store" }),
  pendingComponent: LoadingPage,
  component: McpConsentScreen,
});
