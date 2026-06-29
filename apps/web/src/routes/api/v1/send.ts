import { auth } from "@quieter/auth";
import { MAX_SEND_PAYLOAD_BYTES } from "@quieter/mail/send";
import {
  sendOrganizationMailMessage,
  ORGANIZATION_API_KEY_CONFIG_ID,
  sendMessageInputSchema,
  OrganizationMailSendError,
} from "@quieter/orpc/organization-mail";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/v1/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = getBearerToken(request.headers);

        if (!apiKey) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const verifiedApiKey = await auth.api.verifyApiKey({
          body: {
            configId: ORGANIZATION_API_KEY_CONFIG_ID,
            key: apiKey,
          },
        });

        if (
          !verifiedApiKey.valid ||
          !verifiedApiKey.key ||
          verifiedApiKey.key.configId !== ORGANIZATION_API_KEY_CONFIG_ID
        ) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > MAX_SEND_PAYLOAD_BYTES) {
          return Response.json({ error: "Message payload is too large." }, { status: 413 });
        }

        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return Response.json(
            { error: "Could not parse the json message payload." },
            { status: 400 },
          );
        }

        const parsedMessage = sendMessageInputSchema.safeParse(
          mergeIdempotencyHeader(json, request.headers),
        );

        if (!parsedMessage.success) {
          return Response.json(
            {
              error: "Invalid message payload",
              issues: z.treeifyError(parsedMessage.error),
            },
            { status: 400 },
          );
        }

        try {
          const result = await sendOrganizationMailMessage({
            message: parsedMessage.data,
            organizationId: verifiedApiKey.key.referenceId,
          });

          return Response.json(result, { status: result.idempotent ? 200 : 201 });
        } catch (error) {
          if (error instanceof OrganizationMailSendError) {
            return Response.json({ error: error.message }, { status: error.status });
          }

          console.error(error);
          return Response.json({ error: "Could not send the mail message." }, { status: 500 });
        }
      },
    },
  },
});

const getBearerToken = (headers: Headers) => {
  const authorization = headers.get("authorization")?.trim();

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
};

const mergeIdempotencyHeader = (json: unknown, headers: Headers) => {
  const idempotencyKey = headers.get("idempotency-key")?.trim();

  if (
    !idempotencyKey ||
    !json ||
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
