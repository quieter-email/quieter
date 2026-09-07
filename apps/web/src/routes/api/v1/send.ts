import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  LimitedJsonRequestError,
  readLimitedJsonRequest,
} from "#/lib/limited-json-request.server";
import { getOrganizationApiKeyOrganizationId } from "#/lib/organization-api-auth.server";
import { reportServerError } from "#/lib/server-error-reporting";

const MAX_SEND_PAYLOAD_BYTES = 25 * 1024 * 1024;

export const Route = createFileRoute("/api/v1/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const organizationId =
          await getOrganizationApiKeyOrganizationId(request);
        if (organizationId === null) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const organizationMail =
          await import("@quieter/orpc/organization-mail");

        let json: unknown;
        try {
          json = await readLimitedJsonRequest(request, MAX_SEND_PAYLOAD_BYTES);
        } catch (error) {
          if (!(error instanceof LimitedJsonRequestError)) {
            throw error;
          }
          return Response.json(
            {
              error:
                error.status === 413
                  ? "Message payload is too large."
                  : "Could not parse the json message payload.",
            },
            { status: error.status }
          );
        }

        const parsedMessage = organizationMail.sendMessageInputSchema.safeParse(
          mergeIdempotencyHeader(json, request.headers)
        );

        if (!parsedMessage.success) {
          return Response.json(
            {
              error: "Invalid message payload",
              issues: z.treeifyError(parsedMessage.error),
            },
            { status: 400 }
          );
        }

        try {
          const result = await organizationMail.sendOrganizationMailMessage({
            message: parsedMessage.data,
            organizationId,
          });

          return Response.json(result, {
            status: result.idempotent === true ? 200 : 201,
          });
        } catch (error) {
          if (error instanceof organizationMail.OrganizationMailSendError) {
            return Response.json(
              { error: error.message },
              { status: error.status }
            );
          }

          reportServerError(error, "organization-mail-send");
          return Response.json(
            { error: "Could not send the mail message." },
            { status: 500 }
          );
        }
      },
    },
  },
});

const mergeIdempotencyHeader = (json: unknown, headers: Headers) => {
  const idempotencyKey = headers.get("idempotency-key")?.trim();

  if (
    idempotencyKey === null ||
    idempotencyKey === undefined ||
    idempotencyKey === "" ||
    json === null ||
    json === undefined ||
    typeof json !== "object" ||
    Array.isArray(json) ||
    "idempotencyKey" in json
  ) {
    return json;
  }

  return {
    ...json,
    idempotencyKey,
  };
};
