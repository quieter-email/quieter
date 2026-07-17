import { createFileRoute } from "@tanstack/react-router";

const redirectWithStatus = (
  requestUrl: string,
  returnTo: string,
  status: "connected" | "error",
  mailboxId?: string,
) => {
  const redirectUrl = new URL(returnTo, requestUrl);
  if (status === "connected" && mailboxId && redirectUrl.pathname === "/") {
    redirectUrl.searchParams.set("gmailLink", "complete");
    redirectUrl.searchParams.set("mailboxId", mailboxId);
  } else {
    redirectUrl.searchParams.set("gmail", status);
  }
  return Response.redirect(redirectUrl, 302);
};

export const Route = createFileRoute("/api/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state || url.searchParams.has("error")) {
          return redirectWithStatus(request.url, "/settings?tab=mailboxes", "error");
        }

        try {
          const { completeGmailOAuth } = await import("@quieter/orpc/mailbox");
          const result = await completeGmailOAuth({
            code,
            headers: request.headers,
            state,
          });
          return redirectWithStatus(request.url, result.returnTo, "connected", result.mailboxId);
        } catch (error) {
          console.error(error);
          return redirectWithStatus(request.url, "/settings?tab=mailboxes", "error");
        }
      },
    },
  },
});
