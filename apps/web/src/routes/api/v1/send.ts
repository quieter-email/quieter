import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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

        const body = await readBoundedRequestBody(request);
        if (body === null) {
          return Response.json(
            { error: "Message payload is too large." },
            { status: 413 }
          );
        }

        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return Response.json(
            { error: "Could not parse the json message payload." },
            { status: 400 }
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

const readBoundedRequestBody = async (request: Request) => {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    contentLength !== "" &&
    Number(contentLength) > MAX_SEND_PAYLOAD_BYTES
  ) {
    return null;
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    byteLength += value.byteLength;
    if (byteLength > MAX_SEND_PAYLOAD_BYTES) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
};

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
