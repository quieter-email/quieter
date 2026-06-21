import { handlePolarBillingWebhook } from "@quieter/billing";
import { createFileRoute } from "@tanstack/react-router";
import { reportServerError } from "~/lib/server-error-reporting";

export const Route = createFileRoute("/api/billing/polar-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await handlePolarBillingWebhook({
            body: await request.text(),
            fullUrl: request.url,
            headers: request.headers,
          });

          return Response.json({ success: true });
        } catch (error) {
          reportServerError(error, "polar-webhook");

          return Response.json({ error: "Could not process the Polar webhook." }, { status: 500 });
        }
      },
    },
  },
});
