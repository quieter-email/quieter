import { ORPCError } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

import { reportServerError } from "#/lib/server-error-reporting";

const pageHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

export const Route = createFileRoute("/api/v1/unsubscribe/$token")({
  server: {
    handlers: {
      GET: (): Response =>
        new Response(
          `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><style>body{font:17px/1.6 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:1.5rem;color:#252525;background:#faf9f6}button{font:inherit;padding:.65rem 1.1rem;border:0;border-radius:.5rem;background:#252525;color:white;cursor:pointer}</style><h1>Leave this audience</h1><p>You will stop receiving broadcasts from this audience. Your other subscriptions will stay the same.</p><form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form></html>`,
          { headers: pageHeaders }
        ),
      POST: async ({ request, params }): Promise<Response> => {
        if (!/^[\w-]{40,100}$/u.test(params.token)) {
          return new Response("This unsubscribe link is invalid.", {
            headers: pageHeaders,
            status: 404,
          });
        }
        const contentType = request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim();
        if (
          contentType !== "application/x-www-form-urlencoded" &&
          contentType !== "multipart/form-data"
        ) {
          return new Response("Send the one-click unsubscribe form.", {
            headers: pageHeaders,
            status: 415,
          });
        }
        const declaredLength = Number(request.headers.get("content-length"));
        if (declaredLength > 4096) {
          return new Response(null, { status: 413 });
        }
        try {
          const { readLimitedRequestText } =
            await import("#/lib/unsubscribe-request.server");
          const body = await readLimitedRequestText(request, 4096);
          let oneClick: string | null = null;
          if (contentType === "application/x-www-form-urlencoded") {
            oneClick = new URLSearchParams(body).get("List-Unsubscribe");
          } else {
            const form = await new Response(body, {
              headers: {
                "content-type": request.headers.get("content-type") ?? "",
              },
            }).formData();
            const value = form.get("List-Unsubscribe");
            if (typeof value === "string") {
              oneClick = value;
            }
          }
          if (oneClick !== "One-Click") {
            return new Response("Invalid unsubscribe request.", {
              headers: pageHeaders,
              status: 400,
            });
          }
          const { unsubscribeCampaignRecipient } =
            await import("@quieter/orpc/campaigns");
          await unsubscribeCampaignRecipient(params.token);
          return new Response(
            '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><h1>You have been unsubscribed</h1><p>You will no longer receive broadcasts from this audience.</p></html>',
            { headers: pageHeaders }
          );
        } catch (error) {
          if (error instanceof ORPCError && error.status < 500) {
            return new Response(error.message, {
              headers: pageHeaders,
              status: error.status,
            });
          }
          if (error instanceof RangeError) {
            return new Response(null, { status: 413 });
          }
          reportServerError(error, "campaign-unsubscribe");
          return new Response("Could not unsubscribe. Please try again.", {
            headers: pageHeaders,
            status: 500,
          });
        }
      },
    },
  },
});
