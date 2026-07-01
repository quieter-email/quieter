import { completeConnectorOAuth } from "@quieter/orpc/connectors";
import { createFileRoute } from "@tanstack/react-router";

const redirectWithStatus = (
  requestUrl: string,
  returnTo: string,
  status: "connected" | "error",
) => {
  const redirectUrl = new URL(returnTo, requestUrl);
  redirectUrl.searchParams.set("connector", status);
  return Response.redirect(redirectUrl, 302);
};

export const Route = createFileRoute("/api/connectors/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state || url.searchParams.has("error")) {
          return redirectWithStatus(request.url, "/settings?tab=connectors", "error");
        }

        try {
          const result = await completeConnectorOAuth({
            code,
            headers: request.headers,
            state,
          });
          return redirectWithStatus(request.url, result.returnTo, "connected");
        } catch (error) {
          console.error(error);
          return redirectWithStatus(request.url, "/settings?tab=connectors", "error");
        }
      },
    },
  },
});
