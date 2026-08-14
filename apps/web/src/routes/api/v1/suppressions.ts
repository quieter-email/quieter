import { createFileRoute } from "@tanstack/react-router";

import { getOrganizationApiKeyOrganizationId } from "#/lib/organization-api-auth.server";
import { reportServerError } from "#/lib/server-error-reporting";

export const Route = createFileRoute("/api/v1/suppressions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const organizationId =
          await getOrganizationApiKeyOrganizationId(request);
        if (organizationId === null) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const limitParameter = new URL(request.url).searchParams.get("limit");
        const requestedLimit =
          limitParameter === null ? undefined : Number(limitParameter);
        const limit =
          requestedLimit !== undefined && Number.isSafeInteger(requestedLimit)
            ? requestedLimit
            : undefined;
        try {
          const { listOrganizationMailRecipientSuppressions } =
            await import("@quieter/orpc/organization-mail-delivery");
          const suppressions = await listOrganizationMailRecipientSuppressions({
            limit,
            organizationId,
          });
          return Response.json({ data: suppressions });
        } catch (error) {
          reportServerError(error, "organization-mail-suppressions");
          return Response.json(
            { error: "Could not load recipient suppressions." },
            { status: 500 }
          );
        }
      },
    },
  },
});
