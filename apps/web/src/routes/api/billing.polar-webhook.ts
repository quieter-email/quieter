import { handlePolarBillingWebhook } from "@quieter/billing";
import { createFileRoute } from "@tanstack/react-router";

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
          console.error(error);

          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Could not process the Polar webhook.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
