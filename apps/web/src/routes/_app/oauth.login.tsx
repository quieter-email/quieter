import { LoadingPage } from "@quieter/app/components/loading-page";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { McpLoginScreen } from "#/components/mcp-login-screen";
import { getMcpLogin } from "#/lib/mcp-oauth.functions";

export const Route = createFileRoute("/_app/oauth/login")({
  validateSearch: zodValidator(
    z.object({ request: z.string().min(1).max(8192) })
  ),
  loaderDeps: ({ search }) => ({ request: search.request }),
  ssr: "data-only",
  loader: async ({ deps }) => {
    const { continueTo } = await getMcpLogin({ data: deps });
    if (continueTo !== null) {
      throw redirect({ href: continueTo, reloadDocument: true });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in to quieter" },
      { content: "noindex, nofollow", name: "robots" },
      { content: "no-referrer", name: "referrer" },
    ],
  }),
  headers: () => ({ "Cache-Control": "no-store" }),
  pendingComponent: LoadingPage,
  component: McpLoginScreen,
});
