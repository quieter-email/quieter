import { ORPCError } from "@orpc/server";
import { controlRequestSchema } from "@quieter/mail/control";
import { createFileRoute } from "@tanstack/react-router";

import {
  LimitedJsonRequestError,
  readLimitedJsonRequest,
} from "#/lib/limited-json-request.server";
import { getOrganizationApiKeyAccess } from "#/lib/organization-api-auth.server";
import { reportServerError } from "#/lib/server-error-reporting";

export const Route = createFileRoute("/api/v1/control")({
  server: {
    handlers: {
      POST: async ({ request }): Promise<Response> => {
        try {
          const actor = await getOrganizationApiKeyAccess(request);
          if (actor === null) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
          const parsed = controlRequestSchema.safeParse(
            await readLimitedJsonRequest(request, 1024 * 1024)
          );
          if (!parsed.success) {
            return Response.json(
              { error: "A valid operation and input are required." },
              { status: 400 }
            );
          }
          const { executeControlOperation } =
            await import("@quieter/orpc/control");
          return Response.json(
            await executeControlOperation(
              actor,
              parsed.data.operation,
              parsed.data.input
            ),
            { headers: { "cache-control": "no-store" } }
          );
        } catch (error) {
          if (error instanceof LimitedJsonRequestError) {
            return Response.json(
              {
                error:
                  error.status === 413
                    ? "Request body is too large."
                    : "Invalid JSON body.",
              },
              { status: error.status }
            );
          }
          if (error instanceof ORPCError && error.status < 500) {
            return Response.json(
              { error: error.message },
              { status: error.status }
            );
          }
          reportServerError(error, "control-api");
          return Response.json(
            { error: "Could not complete this action. Try again." },
            { status: 500 }
          );
        }
      },
    },
  },
});
