import { auth } from "@quieter/auth";
import {
  sendOrganizationMailMessage,
  ORGANIZATION_API_KEY_CONFIG_ID,
  organizationMailMessageSchema,
  OrganizationMailSendError,
} from "@quieter/orpc/organization-mail";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/messages")({
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

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return Response.json(
            { error: "Could not parse the json message payload." },
            { status: 400 },
          );
        }

        const parsedMessage = organizationMailMessageSchema.safeParse(json);

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

          return Response.json(result, { status: 201 });
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
