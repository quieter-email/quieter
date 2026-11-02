import { messageDeliverySchema } from "@quieter/mail/delivery";
import {
  rejectApiCompatibility,
  stampApiCompatibility,
} from "@quieter/mail/public-api";
import { createFileRoute } from "@tanstack/react-router";

import { getOrganizationApiKeyOrganizationId } from "#/lib/organization-api-auth.server";
import { reportServerError } from "#/lib/server-error-reporting";

const handleMessage = async (
  request: Request,
  messageId: string
): Promise<Response> => {
  const organizationId = await getOrganizationApiKeyOrganizationId(request);
  if (organizationId === null) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { getOrganizationMailDelivery } =
      await import("@quieter/orpc/organization-mail-delivery");
    const delivery = await getOrganizationMailDelivery({
      organizationId,
      providerMessageId: messageId,
    });
    if (delivery === null) {
      return Response.json({ error: "Message not found." }, { status: 404 });
    }
    return Response.json(messageDeliverySchema.parse(delivery));
  } catch (error) {
    reportServerError(error, "organization-mail-delivery");
    return Response.json(
      { error: "Could not load message delivery status." },
      { status: 500 }
    );
  }
};

export const Route = createFileRoute("/api/messages/$messageId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const rejected = rejectApiCompatibility(request.headers);
        if (rejected !== null) {
          return rejected;
        }
        return stampApiCompatibility(
          await handleMessage(request, params.messageId)
        );
      },
    },
  },
});
