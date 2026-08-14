import { createFileRoute } from "@tanstack/react-router";

import { getOrganizationApiKeyOrganizationId } from "#/lib/organization-api-auth.server";
import { reportServerError } from "#/lib/server-error-reporting";

export const Route = createFileRoute("/api/v1/messages/$messageId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const organizationId =
          await getOrganizationApiKeyOrganizationId(request);
        if (organizationId === null) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const { getOrganizationMailDelivery } =
            await import("@quieter/orpc/organization-mail-delivery");
          const delivery = await getOrganizationMailDelivery({
            organizationId,
            providerMessageId: params.messageId,
          });
          if (delivery === null) {
            return Response.json(
              { error: "Message not found." },
              { status: 404 }
            );
          }
          return Response.json(delivery);
        } catch (error) {
          reportServerError(error, "organization-mail-delivery");
          return Response.json(
            { error: "Could not load message delivery status." },
            { status: 500 }
          );
        }
      },
    },
  },
});
