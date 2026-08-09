import { createFileRoute } from "@tanstack/react-router";

import { reportServerError } from "#/lib/server-error-reporting";

const redirectWithResult = (
  requestUrl: string,
  returnTo: string,
  result: "canceled" | "error" | "needs_dns" | "verified"
) => {
  const redirectUrl = new URL(returnTo, requestUrl);
  redirectUrl.searchParams.set("domainConnect", result);
  return Response.redirect(redirectUrl, 302);
};

export const Route = createFileRoute("/api/domain-connect/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const state = url.searchParams.get("state");
        if (state === null || state === "") {
          return redirectWithResult(
            request.url,
            "/settings?tab=organization&organizationView=domains",
            "error"
          );
        }

        try {
          const { completeDomainConnect } =
            await import("@quieter/orpc/domain-connect");
          const completed = await completeDomainConnect({
            error: url.searchParams.get("error"),
            headers: request.headers,
            state,
          });
          let result: "canceled" | "error" | "needs_dns" | "verified" = "error";
          if (completed.result === "verified") {
            result = "verified";
          } else if (completed.result === "needs_dns") {
            result = "needs_dns";
          } else if (completed.result === "canceled") {
            result = "canceled";
          }
          return redirectWithResult(request.url, completed.returnTo, result);
        } catch (error) {
          reportServerError(error, "domain-connect-callback");
          return redirectWithResult(
            request.url,
            "/settings?tab=organization&organizationView=domains",
            "error"
          );
        }
      },
    },
  },
});
