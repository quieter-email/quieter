import { createFileRoute } from "@tanstack/react-router";

const redirectWithResult = (
  requestUrl: string,
  returnTo: string,
  result: "canceled" | "error" | "needs_dns" | "verified",
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
        if (!state) {
          return redirectWithResult(
            request.url,
            "/settings?tab=organization&organizationView=domains",
            "error",
          );
        }

        try {
          const { completeDomainConnect } = await import("@quieter/orpc/domain-connect");
          const completed = await completeDomainConnect({
            error: url.searchParams.get("error"),
            headers: request.headers,
            state,
          });
          return redirectWithResult(
            request.url,
            completed.returnTo,
            completed.result === "verified"
              ? "verified"
              : completed.result === "needs_dns"
                ? "needs_dns"
                : completed.result === "canceled"
                  ? "canceled"
                  : "error",
          );
        } catch (error) {
          console.error(error);
          return redirectWithResult(
            request.url,
            "/settings?tab=organization&organizationView=domains",
            "error",
          );
        }
      },
    },
  },
});
