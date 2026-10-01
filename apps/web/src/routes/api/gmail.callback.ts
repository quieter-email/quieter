import { ORPCError } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";
import { deleteCookie, setCookie } from "@tanstack/react-start/server";

import { getSettingsReturnTo } from "#/features/settings/components/mailboxes-settings-shared";
import { reportServerError } from "#/lib/server-error-reporting";

const redirectWithStatus = (
  requestUrl: string,
  returnTo: string,
  status: "connected" | "error",
  mailboxId?: string
) => {
  const redirectUrl = new URL(returnTo, requestUrl);
  if (
    status === "connected" &&
    mailboxId !== undefined &&
    mailboxId !== "" &&
    redirectUrl.pathname === "/"
  ) {
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
        let failureReturnTo = getSettingsReturnTo();
        deleteCookie("gmail-callback-error", { path: "/" });
        try {
          const { completeGmailOAuth, getGmailOAuthCallbackMailboxId } =
            await import("@quieter/orpc/mailbox");
          if (state) {
            const mailboxId = await getGmailOAuthCallbackMailboxId({
              headers: request.headers,
              state,
            });
            failureReturnTo = getSettingsReturnTo(mailboxId ?? "");
          }
          if (!code || !state || url.searchParams.has("error")) {
            return redirectWithStatus(request.url, failureReturnTo, "error");
          }
          const result = await completeGmailOAuth({
            code,
            headers: request.headers,
            state,
          });
          return redirectWithStatus(
            request.url,
            result.returnTo,
            "connected",
            result.mailboxId
          );
        } catch (error) {
          const isExpectedFailure =
            error instanceof ORPCError &&
            (error.code === "BAD_REQUEST" ||
              error.code === "CONFLICT" ||
              error.code === "FORBIDDEN" ||
              error.code === "UNAUTHORIZED");
          if (isExpectedFailure) {
            setCookie(
              "gmail-callback-error",
              JSON.stringify({
                message: error.message,
                status: error.status,
              }),
              {
                httpOnly: true,
                maxAge: 120,
                path: "/",
                sameSite: "lax",
                secure: url.protocol === "https:",
              }
            );
          } else {
            reportServerError(error, "gmail-oauth-callback");
          }
          return redirectWithStatus(request.url, failureReturnTo, "error");
        }
      },
    },
  },
});
